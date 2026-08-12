import { execFile, spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  createCloudFormationTemplate,
  normalizeGitHubRepositoryUrl,
  validateProvisionConfig,
  type Ec2ProvisionConfig
} from "./ec2-infrastructure.js";

type Action = "connect" | "destroy" | "provision" | "status";

interface AwsContext {
  profile?: string;
  region: string;
}

interface StackOutput {
  OutputKey: string;
  OutputValue: string;
}

const execFileAsync = promisify(execFile);

function optionalEnvironment(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function requiredEnvironment(name: string): string {
  const value = optionalEnvironment(name);
  if (!value) {
    throw new Error(`${name} is required`);
  }
  return value;
}

function parseBoolean(name: string, fallback: boolean): boolean {
  const value = optionalEnvironment(name);
  if (!value) {
    return fallback;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${name} must be true or false`);
}

function awsGlobalArguments(context: AwsContext): string[] {
  const argumentsList = ["--region", context.region];
  if (context.profile) {
    argumentsList.push("--profile", context.profile);
  }
  return argumentsList;
}

async function runAws(context: AwsContext, argumentsList: string[]): Promise<string> {
  const result = await execFileAsync("aws", [...awsGlobalArguments(context), ...argumentsList], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024
  });
  return result.stdout.trim();
}

async function readGitValue(argumentsList: string[]): Promise<string> {
  const result = await execFileAsync("git", argumentsList, { encoding: "utf8" });
  return result.stdout.trim();
}

async function repositoryUrl(): Promise<string> {
  const configured = optionalEnvironment("EC2_REPOSITORY_URL");
  const remote = configured || (await readGitValue(["config", "--get", "remote.origin.url"]));
  return normalizeGitHubRepositoryUrl(remote);
}

async function repositoryRef(): Promise<string> {
  return optionalEnvironment("EC2_REPOSITORY_REF") || (await readGitValue(["branch", "--show-current"]));
}

function resolveConfiguredNetwork(): { subnetId: string; vpcId: string } {
  const configuredVpcId = optionalEnvironment("EC2_VPC_ID");
  const configuredSubnetId = optionalEnvironment("EC2_SUBNET_ID");
  if (configuredVpcId || configuredSubnetId) {
    if (!configuredVpcId || !configuredSubnetId) {
      throw new Error("Set both EC2_VPC_ID and EC2_SUBNET_ID, or leave both unset to let the stack create a public VPC");
    }
    return { subnetId: configuredSubnetId, vpcId: configuredVpcId };
  }
  return { subnetId: "", vpcId: "" };
}

async function configuration(context: AwsContext): Promise<Ec2ProvisionConfig> {
  const network = resolveConfiguredNetwork();
  const keyName = optionalEnvironment("EC2_KEY_NAME");
  const sshAllowedCidr = keyName
    ? optionalEnvironment("EC2_SSH_ALLOWED_CIDR") || requiredEnvironment("EC2_ALLOWED_CIDR")
    : "";
  return validateProvisionConfig({
    allowedCidr: requiredEnvironment("EC2_ALLOWED_CIDR"),
    detailedMonitoring: parseBoolean("EC2_DETAILED_MONITORING", true),
    githubTokenSecretArn: optionalEnvironment("EC2_GITHUB_TOKEN_SECRET_ARN"),
    instanceType: optionalEnvironment("EC2_INSTANCE_TYPE") || "c7i.large",
    keyName,
    repositoryRef: await repositoryRef(),
    repositoryUrl: await repositoryUrl(),
    sshAllowedCidr,
    stackName: optionalEnvironment("EC2_STACK_NAME") || "edge-results-benchmark",
    ...network
  });
}

async function stackOutputs(context: AwsContext, stackName: string): Promise<Record<string, string>> {
  if (!(await stackExists(context, stackName))) {
    throw new Error(`Stack ${stackName} does not exist in ${context.region}`);
  }
  const raw = await runAws(context, [
    "cloudformation",
    "describe-stacks",
    "--stack-name",
    stackName,
    "--query",
    "Stacks[0].Outputs",
    "--output",
    "json"
  ]);
  const outputs = JSON.parse(raw) as StackOutput[];
  return Object.fromEntries(outputs.map((output) => [output.OutputKey, output.OutputValue]));
}

async function stackExists(context: AwsContext, stackName: string): Promise<boolean> {
  try {
    await runAws(context, [
      "cloudformation",
      "describe-stacks",
      "--stack-name",
      stackName,
      "--query",
      "Stacks[0].StackId",
      "--output",
      "text"
    ]);
    return true;
  } catch (error: unknown) {
    const stderr =
      typeof error === "object" && error !== null && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr
        : "";
    if (stderr.includes("does not exist")) {
      return false;
    }
    throw error;
  }
}

async function waitForHealth(apiBaseUrl: string): Promise<void> {
  const timeoutSeconds = Number(optionalEnvironment("EC2_BOOTSTRAP_TIMEOUT_SECONDS") || "900");
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 30 || timeoutSeconds > 3600) {
    throw new Error("EC2_BOOTSTRAP_TIMEOUT_SECONDS must be an integer from 30 to 3600");
  }

  const deadline = Date.now() + timeoutSeconds * 1000;
  process.stdout.write(`Waiting for ${apiBaseUrl}/health`);
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${apiBaseUrl}/health`, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) {
        process.stdout.write(" ready\n");
        return;
      }
    } catch {
      // Cloud-init is still installing or the service is not listening yet.
    }
    process.stdout.write(".");
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }
  process.stdout.write(" timed out\n");
  throw new Error(
    "The stack exists, but the API did not become healthy. Use npm run ec2:connect and inspect /var/log/edge-results-bootstrap.log"
  );
}

async function provision(context: AwsContext): Promise<void> {
  const stackName = optionalEnvironment("EC2_STACK_NAME") || "edge-results-benchmark";
  if (await stackExists(context, stackName)) {
    throw new Error(
      `Stack ${stackName} already exists. EC2 user data runs only on first boot; destroy the stack before reprovisioning it.`
    );
  }
  const config = await configuration(context);
  const temporaryDirectory = await mkdtemp(join(tmpdir(), "edge-results-cfn-"));
  const templatePath = join(temporaryDirectory, "template.json");

  try {
    await writeFile(templatePath, `${JSON.stringify(createCloudFormationTemplate(), null, 2)}\n`, "utf8");
    console.log(`Deploying ${config.stackName} in ${context.region} (${config.instanceType})`);
    const parameterOverrides = [
      `AllowedCidr=${config.allowedCidr}`,
      `DetailedMonitoring=${String(config.detailedMonitoring)}`,
      `KeyName=${config.keyName}`,
      `InstanceType=${config.instanceType}`,
      `RepositoryRef=${config.repositoryRef}`,
      `RepositoryUrl=${config.repositoryUrl}`,
      `SshAllowedCidr=${config.sshAllowedCidr}`,
      `SubnetId=${config.subnetId}`,
      `VpcId=${config.vpcId}`
    ];
    if (config.githubTokenSecretArn) {
      parameterOverrides.push(`GitHubTokenSecretArn=${config.githubTokenSecretArn}`);
    }
    await runAws(context, [
      "cloudformation",
      "deploy",
      "--stack-name",
      config.stackName,
      "--template-file",
      templatePath,
      "--capabilities",
      "CAPABILITY_IAM",
      "--no-fail-on-empty-changeset",
      "--parameter-overrides",
      ...parameterOverrides
    ]);

    const outputs = await stackOutputs(context, config.stackName);
    const instanceId = outputs.InstanceId;
    const apiBaseUrl = outputs.ApiBaseUrl;
    if (!instanceId || !apiBaseUrl) {
      throw new Error("CloudFormation did not return InstanceId and ApiBaseUrl outputs");
    }

    await runAws(context, ["ec2", "wait", "instance-status-ok", "--instance-ids", instanceId]);
    await waitForHealth(apiBaseUrl);
    console.log(`Traditional API: ${apiBaseUrl}`);
    console.log(`Instance ID: ${instanceId}`);
    console.log("Set K6_BASE_URL to the Traditional API URL before running k6.");
  } finally {
    await rm(temporaryDirectory, { force: true, recursive: true });
  }
}

async function status(context: AwsContext, stackName: string): Promise<void> {
  const outputs = await stackOutputs(context, stackName);
  const instanceId = outputs.InstanceId;
  if (!instanceId) {
    throw new Error("The stack has no InstanceId output");
  }

  const state = await runAws(context, [
    "ec2",
    "describe-instances",
    "--instance-ids",
    instanceId,
    "--query",
    "Reservations[0].Instances[0].State.Name",
    "--output",
    "text"
  ]);
  console.log(`Stack: ${stackName}`);
  console.log(`Region: ${context.region}`);
  console.log(`Instance: ${instanceId} (${state})`);
  console.log(`Traditional API: ${outputs.ApiBaseUrl ?? "unavailable"}`);
  console.log(`SSH: ${outputs.SshCommand ?? "unavailable"}`);
  console.log(`SSM: ${outputs.SsmCommand ?? "unavailable"}`);
}

async function connect(context: AwsContext, stackName: string): Promise<void> {
  const outputs = await stackOutputs(context, stackName);
  const instanceId = outputs.InstanceId;
  if (!instanceId) {
    throw new Error("The stack has no InstanceId output");
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn("aws", [...awsGlobalArguments(context), "ssm", "start-session", "--target", instanceId], {
      stdio: "inherit"
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Session Manager exited with ${code}`))));
  });
}

async function destroy(context: AwsContext, stackName: string): Promise<void> {
  if (optionalEnvironment("EC2_CONFIRM_DESTROY") !== stackName) {
    throw new Error(`Set EC2_CONFIRM_DESTROY=${stackName} before destroying the stack`);
  }
  console.log(`Deleting ${stackName} in ${context.region}`);
  await runAws(context, ["cloudformation", "delete-stack", "--stack-name", stackName]);
  await runAws(context, ["cloudformation", "wait", "stack-delete-complete", "--stack-name", stackName]);
  console.log(`Deleted ${stackName}`);
}

function requestedAction(): Action {
  const action = process.argv[2] ?? "";
  if (action === "connect" || action === "destroy" || action === "provision" || action === "status") {
    return action;
  }
  throw new Error("Action must be provision, status, connect, or destroy");
}

async function main(): Promise<void> {
  const context: AwsContext = {
    region: optionalEnvironment("AWS_REGION") || optionalEnvironment("AWS_DEFAULT_REGION") || "us-east-1",
    ...(optionalEnvironment("AWS_PROFILE") ? { profile: optionalEnvironment("AWS_PROFILE") } : {})
  };
  const stackName = optionalEnvironment("EC2_STACK_NAME") || "edge-results-benchmark";

  switch (requestedAction()) {
    case "provision":
      await provision(context);
      break;
    case "status":
      await status(context, stackName);
      break;
    case "connect":
      await connect(context, stackName);
      break;
    case "destroy":
      await destroy(context, stackName);
      break;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
