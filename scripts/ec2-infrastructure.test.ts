import { describe, expect, it } from "vitest";
import {
  createCloudFormationTemplate,
  createEc2BootstrapUserData,
  normalizeGitHubRepositoryUrl,
  validateIpv4Cidr,
  validateProvisionConfig
} from "./ec2-infrastructure.js";

describe("EC2 infrastructure", () => {
  it("normalizes the repository SSH remote to token-free HTTPS", () => {
    expect(normalizeGitHubRepositoryUrl("git@github.com:WaelTarabishi/project.git")).toBe(
      "https://github.com/WaelTarabishi/project.git"
    );
    expect(normalizeGitHubRepositoryUrl("https://github.com/WaelTarabishi/project")).toBe(
      "https://github.com/WaelTarabishi/project.git"
    );
  });

  it("rejects repository URLs that could embed credentials or shell input", () => {
    expect(() => normalizeGitHubRepositoryUrl("https://token@github.com/owner/project.git")).toThrow();
    expect(() => normalizeGitHubRepositoryUrl("https://example.com/owner/project.git")).toThrow();
  });

  it("validates the generator IPv4 CIDR", () => {
    expect(validateIpv4Cidr("203.0.113.10/32")).toBe("203.0.113.10/32");
    expect(() => validateIpv4Cidr("300.0.0.1/32")).toThrow("invalid IPv4");
    expect(() => validateIpv4Cidr("0.0.0.0/33")).toThrow("must be an IPv4 CIDR");
  });

  it("rejects unsafe provision parameters", () => {
    const valid = {
      allowedCidr: "203.0.113.10/32",
      detailedMonitoring: true,
      githubTokenSecretArn: "",
      instanceType: "c7i.large",
      keyName: "",
      repositoryRef: "main",
      repositoryUrl: "https://github.com/owner/project.git",
      sshAllowedCidr: "",
      stackName: "edge-results-benchmark",
      subnetId: "subnet-0123456789abcdef0",
      vpcId: "vpc-0123456789abcdef0"
    };

    expect(validateProvisionConfig(valid)).toEqual(valid);
    expect(validateProvisionConfig({ ...valid, vpcId: "", subnetId: "" })).toEqual({
      ...valid,
      vpcId: "",
      subnetId: ""
    });
    expect(() => validateProvisionConfig({ ...valid, repositoryRef: "main;reboot" })).toThrow();
    expect(() => validateProvisionConfig({ ...valid, stackName: "-invalid" })).toThrow();
    expect(() => validateProvisionConfig({ ...valid, vpcId: "vpc-0123456789abcdef0", subnetId: "" })).toThrow(
      "Set both EC2_VPC_ID and EC2_SUBNET_ID"
    );
    expect(
      validateProvisionConfig({
        ...valid,
        keyName: "edge-results-debug",
        sshAllowedCidr: "203.0.113.10/32"
      })
    ).toEqual({
      ...valid,
      keyName: "edge-results-debug",
      sshAllowedCidr: "203.0.113.10/32"
    });
    expect(() =>
      validateProvisionConfig({
        ...valid,
        keyName: "",
        sshAllowedCidr: "203.0.113.10/32"
      })
    ).toThrow("EC2_SSH_ALLOWED_CIDR requires EC2_KEY_NAME");
  });

  it("creates a locked-down instance template", () => {
    const serialized = JSON.stringify(createCloudFormationTemplate());

    expect(serialized).toContain("AmazonSSMManagedInstanceCore");
    expect(serialized).toContain('"HttpTokens":"required"');
    expect(serialized).toContain('"Encrypted":true');
    expect(serialized).toContain('"FromPort":3001');
    expect(serialized).toContain('"FromPort":22');
    expect(serialized).toContain('"KeyName"');
    expect(serialized).toContain('"Type":"AWS::EC2::VPC"');
    expect(serialized).toContain('"Type":"AWS::EC2::InternetGateway"');
    expect(serialized).not.toContain("studentName");
  });

  it("bootstraps Docker, the synthetic database, and the API service", () => {
    const userData = createEc2BootstrapUserData();

    expect(userData).toContain("dnf install -y docker git nodejs22 nodejs22-npm openssl");
    expect(userData).toContain("docker run --detach");
    expect(userData).toContain("--publish 127.0.0.1:5433:5432");
    expect(userData).toContain("npm-22 run db:prepare");
    expect(userData).toContain("npm-22 run build");
    expect(userData).toContain("edge-results-api.service");
    expect(userData).toContain("API_HOST=0.0.0.0");
    expect(userData).not.toContain("replace-with-a-local-password");
  });
});
