export interface Ec2ProvisionConfig {
  allowedCidr: string;
  detailedMonitoring: boolean;
  githubTokenSecretArn: string;
  instanceType: string;
  keyName: string;
  repositoryRef: string;
  repositoryUrl: string;
  sshAllowedCidr: string;
  stackName: string;
  subnetId: string;
  vpcId: string;
}

type CloudFormationValue =
  | boolean
  | number
  | string
  | CloudFormationValue[]
  | { [key: string]: CloudFormationValue };

export interface CloudFormationTemplate {
  AWSTemplateFormatVersion: string;
  Description: string;
  Conditions: Record<string, CloudFormationValue>;
  Outputs: Record<string, CloudFormationValue>;
  Parameters: Record<string, CloudFormationValue>;
  Resources: Record<string, CloudFormationValue>;
}

const GITHUB_SSH_PATTERN = /^git@github\.com:([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?)$/u;
const GITHUB_HTTPS_PATTERN = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/u;
const CIDR_PATTERN = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})\/(\d|[12]\d|3[0-2])$/u;

export function normalizeGitHubRepositoryUrl(remote: string): string {
  const trimmed = remote.trim();
  const sshMatch = GITHUB_SSH_PATTERN.exec(trimmed);
  if (sshMatch?.[1]) {
    const path = sshMatch[1].endsWith(".git") ? sshMatch[1] : `${sshMatch[1]}.git`;
    return `https://github.com/${path}`;
  }

  if (GITHUB_HTTPS_PATTERN.test(trimmed)) {
    return trimmed.endsWith(".git") ? trimmed : `${trimmed}.git`;
  }

  throw new Error("EC2_REPOSITORY_URL must be a GitHub HTTPS or git@github.com repository URL");
}

export function validateIpv4Cidr(cidr: string): string {
  const match = CIDR_PATTERN.exec(cidr.trim());
  if (!match) {
    throw new Error("EC2_ALLOWED_CIDR must be an IPv4 CIDR such as 203.0.113.10/32");
  }

  const octets = match.slice(1, 5).map(Number);
  if (octets.some((octet) => octet > 255)) {
    throw new Error("EC2_ALLOWED_CIDR contains an invalid IPv4 address");
  }

  return cidr.trim();
}

export function validateProvisionConfig(config: Ec2ProvisionConfig): Ec2ProvisionConfig {
  const stackNamePattern = /^[A-Za-z][A-Za-z0-9-]{0,127}$/u;
  const instanceTypePattern = /^[a-z][a-z0-9]*\.[a-z0-9]+$/u;
  const keyNamePattern = /^[A-Za-z0-9._-]{1,255}$/u;
  const repositoryRefPattern = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]+$/u;
  const resourceIdPattern = /^(vpc|subnet)-[a-f0-9]+$/u;
  const hasVpcId = config.vpcId.length > 0;
  const hasSubnetId = config.subnetId.length > 0;
  const hasKeyName = config.keyName.length > 0;
  const hasSshAllowedCidr = config.sshAllowedCidr.length > 0;

  if (!stackNamePattern.test(config.stackName)) {
    throw new Error("EC2_STACK_NAME must be a valid CloudFormation stack name");
  }
  if (!instanceTypePattern.test(config.instanceType)) {
    throw new Error("EC2_INSTANCE_TYPE must look like c7i.large");
  }
  if (!repositoryRefPattern.test(config.repositoryRef)) {
    throw new Error("EC2_REPOSITORY_REF contains unsupported characters");
  }
  if (hasKeyName && !keyNamePattern.test(config.keyName)) {
    throw new Error("EC2_KEY_NAME must be a valid EC2 key pair name");
  }
  if (!hasKeyName && hasSshAllowedCidr) {
    throw new Error("EC2_SSH_ALLOWED_CIDR requires EC2_KEY_NAME");
  }
  if (hasVpcId !== hasSubnetId) {
    throw new Error("Set both EC2_VPC_ID and EC2_SUBNET_ID, or leave both unset to create a public benchmark VPC");
  }
  if (hasVpcId && (!resourceIdPattern.test(config.vpcId) || !config.vpcId.startsWith("vpc-"))) {
    throw new Error("EC2_VPC_ID must be a valid VPC ID");
  }
  if (hasSubnetId && (!resourceIdPattern.test(config.subnetId) || !config.subnetId.startsWith("subnet-"))) {
    throw new Error("EC2_SUBNET_ID must be a valid subnet ID");
  }
  if (
    config.githubTokenSecretArn &&
    !/^arn:aws[a-zA-Z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/u.test(
      config.githubTokenSecretArn
    )
  ) {
    throw new Error("EC2_GITHUB_TOKEN_SECRET_ARN must be a Secrets Manager secret ARN");
  }

  return {
    ...config,
    allowedCidr: validateIpv4Cidr(config.allowedCidr),
    repositoryUrl: normalizeGitHubRepositoryUrl(config.repositoryUrl),
    sshAllowedCidr: hasSshAllowedCidr ? validateIpv4Cidr(config.sshAllowedCidr) : ""
  };
}

export function createEc2BootstrapUserData(): string {
  return `#!/bin/bash
set -euo pipefail

exec > >(tee /var/log/edge-results-bootstrap.log | logger -t edge-results-bootstrap -s 2>/dev/console) 2>&1

APP_DIR=/opt/edge-results-benchmark
REPOSITORY_URL='\${RepositoryUrl}'
REPOSITORY_REF='\${RepositoryRef}'
GITHUB_TOKEN_SECRET_ARN='\${GitHubTokenSecretArn}'

dnf -y --releasever=latest update
dnf install -y docker git nodejs22 nodejs22-npm openssl
alternatives --set node /usr/bin/node-22
systemctl enable --now docker
usermod -a -G docker ec2-user

if [ -n "$GITHUB_TOKEN_SECRET_ARN" ]; then
  export GITHUB_TOKEN
  GITHUB_TOKEN=$(aws secretsmanager get-secret-value \
    --secret-id "$GITHUB_TOKEN_SECRET_ARN" \
    --query SecretString \
    --output text \
    --region '\${AWS::Region}')
  ASKPASS_FILE=$(mktemp)
  cat > "$ASKPASS_FILE" <<'ASKPASS'
#!/bin/sh
case "$1" in
  *Username*) printf '%s\\n' 'x-access-token' ;;
  *) printf '%s\\n' "$GITHUB_TOKEN" ;;
esac
ASKPASS
  chmod 700 "$ASKPASS_FILE"
  GIT_ASKPASS="$ASKPASS_FILE" GIT_TERMINAL_PROMPT=0 git clone \
    --depth 1 --branch "$REPOSITORY_REF" "$REPOSITORY_URL" "$APP_DIR"
  rm -f "$ASKPASS_FILE"
  unset GITHUB_TOKEN
else
  git clone --depth 1 --branch "$REPOSITORY_REF" "$REPOSITORY_URL" "$APP_DIR"
fi

chown -R ec2-user:ec2-user "$APP_DIR"
cd "$APP_DIR"

umask 077
POSTGRES_PASSWORD=$(openssl rand -hex 24)
LOOKUP_KEY_SECRET=$(openssl rand -hex 32)
cat > .env <<ENVIRONMENT
POSTGRES_DB=results_benchmark
POSTGRES_USER=benchmark
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgres://benchmark:$POSTGRES_PASSWORD@127.0.0.1:5433/results_benchmark
API_HOST=0.0.0.0
API_PORT=3001
DATABASE_POOL_MAX=10
LOG_LEVEL=warn
LOOKUP_KEY_SECRET=$LOOKUP_KEY_SECRET
ENVIRONMENT
chown ec2-user:ec2-user .env
chmod 600 .env

sudo -u ec2-user /usr/bin/npm-22 ci
docker volume create edge-results-postgres-data >/dev/null
docker run --detach \
  --name edge-results-postgres \
  --restart unless-stopped \
  --env POSTGRES_DB=results_benchmark \
  --env POSTGRES_USER=benchmark \
  --env POSTGRES_PASSWORD="$POSTGRES_PASSWORD" \
  --publish 127.0.0.1:5433:5432 \
  --volume edge-results-postgres-data:/var/lib/postgresql/data \
  postgres:16-alpine \
  -c shared_preload_libraries=pg_stat_statements \
  -c track_io_timing=on
for attempt in $(seq 1 60); do
  if docker exec edge-results-postgres pg_isready -U benchmark -d results_benchmark >/dev/null 2>&1; then
    break
  fi
  sleep 2
done
docker exec edge-results-postgres pg_isready -U benchmark -d results_benchmark
sudo -u ec2-user /usr/bin/npm-22 run db:prepare
sudo -u ec2-user /usr/bin/npm-22 run build

cat > /etc/systemd/system/edge-results-api.service <<'SERVICE'
[Unit]
Description=Edge results traditional benchmark API
After=network-online.target docker.service
Wants=network-online.target
Requires=docker.service

[Service]
Type=simple
User=ec2-user
Group=ec2-user
SupplementaryGroups=docker
WorkingDirectory=/opt/edge-results-benchmark
Environment=NODE_ENV=production
EnvironmentFile=/opt/edge-results-benchmark/.env
ExecStart=/usr/bin/npm-22 run start --workspace @edge-results/api
Restart=on-failure
RestartSec=3
TimeoutStopSec=30

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now edge-results-api.service

for attempt in $(seq 1 60); do
  if curl --fail --silent http://127.0.0.1:3001/health >/dev/null; then
    printf '%s\\n' 'EC2 benchmark application is healthy'
    exit 0
  fi
  sleep 2
done

systemctl status edge-results-api.service --no-pager || true
journalctl -u edge-results-api.service --no-pager -n 100 || true
exit 1
`;
}

export function createCloudFormationTemplate(): CloudFormationTemplate {
  const hasGitHubToken = { "Fn::Not": [{ "Fn::Equals": [{ Ref: "GitHubTokenSecretArn" }, ""] }] };
  const hasKeyName = { "Fn::Not": [{ "Fn::Equals": [{ Ref: "KeyName" }, ""] }] };
  const detailedMonitoring = { "Fn::Equals": [{ Ref: "DetailedMonitoring" }, "true"] };
  const useProvidedNetwork = { "Fn::Not": [{ "Fn::Equals": [{ Ref: "VpcId" }, ""] }] };
  const createManagedNetwork = { "Fn::Equals": [{ Ref: "VpcId" }, ""] };
  const selectedVpcId = { "Fn::If": ["UseProvidedNetwork", { Ref: "VpcId" }, { Ref: "BenchmarkVpc" }] };
  const selectedSubnetId = { "Fn::If": ["UseProvidedNetwork", { Ref: "SubnetId" }, { Ref: "BenchmarkSubnet" }] };

  return {
    AWSTemplateFormatVersion: "2010-09-09",
    Description: "EC2 host for the traditional edge-results benchmark path",
    Parameters: {
      AllowedCidr: { Type: "String" },
      DetailedMonitoring: { AllowedValues: ["true", "false"], Type: "String" },
      GitHubTokenSecretArn: { Default: "", Type: "String" },
      InstanceType: { Type: "String" },
      KeyName: { Default: "", Type: "String" },
      RepositoryRef: { Type: "String" },
      RepositoryUrl: { Type: "String" },
      SshAllowedCidr: { Default: "", Type: "String" },
      SubnetId: { Default: "", Type: "String" },
      VpcId: { Default: "", Type: "String" }
    },
    Conditions: {
      HasGitHubToken: hasGitHubToken,
      HasKeyName: hasKeyName,
      UseDetailedMonitoring: detailedMonitoring,
      CreateManagedNetwork: createManagedNetwork,
      UseProvidedNetwork: useProvidedNetwork
    },
    Resources: {
      InstanceRole: {
        Type: "AWS::IAM::Role",
        Properties: {
          AssumeRolePolicyDocument: {
            Version: "2012-10-17",
            Statement: [
              {
                Action: "sts:AssumeRole",
                Effect: "Allow",
                Principal: { Service: ["ec2.amazonaws.com"] }
              }
            ]
          },
          ManagedPolicyArns: ["arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"],
          Policies: {
            "Fn::If": [
              "HasGitHubToken",
              [
                {
                  PolicyName: "ReadGitHubToken",
                  PolicyDocument: {
                    Version: "2012-10-17",
                    Statement: [
                      {
                        Action: "secretsmanager:GetSecretValue",
                        Effect: "Allow",
                        Resource: { Ref: "GitHubTokenSecretArn" }
                      }
                    ]
                  }
                }
              ],
              { Ref: "AWS::NoValue" }
            ]
          }
        }
      },
      InstanceProfile: {
        Type: "AWS::IAM::InstanceProfile",
        Properties: { Roles: [{ Ref: "InstanceRole" }] }
      },
      BenchmarkVpc: {
        Type: "AWS::EC2::VPC",
        Condition: "CreateManagedNetwork",
        Properties: {
          CidrBlock: "10.42.0.0/16",
          EnableDnsHostnames: true,
          EnableDnsSupport: true,
          Tags: [
            { Key: "Name", Value: "edge-results-benchmark-vpc" },
            { Key: "Project", Value: "edge-results-benchmark" }
          ]
        }
      },
      BenchmarkInternetGateway: {
        Type: "AWS::EC2::InternetGateway",
        Condition: "CreateManagedNetwork",
        Properties: {
          Tags: [
            { Key: "Name", Value: "edge-results-benchmark-igw" },
            { Key: "Project", Value: "edge-results-benchmark" }
          ]
        }
      },
      BenchmarkVpcGatewayAttachment: {
        Type: "AWS::EC2::VPCGatewayAttachment",
        Condition: "CreateManagedNetwork",
        Properties: {
          InternetGatewayId: { Ref: "BenchmarkInternetGateway" },
          VpcId: { Ref: "BenchmarkVpc" }
        }
      },
      BenchmarkSubnet: {
        Type: "AWS::EC2::Subnet",
        Condition: "CreateManagedNetwork",
        Properties: {
          AvailabilityZone: { "Fn::Select": [0, { "Fn::GetAZs": "" }] },
          CidrBlock: "10.42.0.0/24",
          MapPublicIpOnLaunch: true,
          Tags: [
            { Key: "Name", Value: "edge-results-benchmark-public-a" },
            { Key: "Project", Value: "edge-results-benchmark" }
          ],
          VpcId: { Ref: "BenchmarkVpc" }
        }
      },
      BenchmarkRouteTable: {
        Type: "AWS::EC2::RouteTable",
        Condition: "CreateManagedNetwork",
        Properties: {
          Tags: [
            { Key: "Name", Value: "edge-results-benchmark-public" },
            { Key: "Project", Value: "edge-results-benchmark" }
          ],
          VpcId: { Ref: "BenchmarkVpc" }
        }
      },
      BenchmarkDefaultRoute: {
        Type: "AWS::EC2::Route",
        Condition: "CreateManagedNetwork",
        DependsOn: "BenchmarkVpcGatewayAttachment",
        Properties: {
          DestinationCidrBlock: "0.0.0.0/0",
          GatewayId: { Ref: "BenchmarkInternetGateway" },
          RouteTableId: { Ref: "BenchmarkRouteTable" }
        }
      },
      BenchmarkSubnetRouteTableAssociation: {
        Type: "AWS::EC2::SubnetRouteTableAssociation",
        Condition: "CreateManagedNetwork",
        Properties: {
          RouteTableId: { Ref: "BenchmarkRouteTable" },
          SubnetId: { Ref: "BenchmarkSubnet" }
        }
      },
      ServerSecurityGroup: {
        Type: "AWS::EC2::SecurityGroup",
        Properties: {
          GroupDescription: "Permit benchmark API access only from the k6 generator",
          SecurityGroupEgress: [
            { CidrIp: "0.0.0.0/0", IpProtocol: "-1" }
          ],
          SecurityGroupIngress: [
            {
              CidrIp: { Ref: "AllowedCidr" },
              Description: "k6 generator to Fastify API",
              FromPort: 3001,
              IpProtocol: "tcp",
              ToPort: 3001
            },
            {
              "Fn::If": [
                "HasKeyName",
                {
                  CidrIp: { Ref: "SshAllowedCidr" },
                  Description: "manual SSH debugging",
                  FromPort: 22,
                  IpProtocol: "tcp",
                  ToPort: 22
                },
                { Ref: "AWS::NoValue" }
              ]
            }
          ],
          VpcId: selectedVpcId
        }
      },
      BenchmarkInstance: {
        Type: "AWS::EC2::Instance",
        Properties: {
          BlockDeviceMappings: [
            {
              DeviceName: "/dev/xvda",
              Ebs: {
                DeleteOnTermination: true,
                Encrypted: true,
                VolumeSize: 20,
                VolumeType: "gp3"
              }
            }
          ],
          IamInstanceProfile: { Ref: "InstanceProfile" },
          ImageId: "{{resolve:ssm:/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64}}",
          InstanceType: { Ref: "InstanceType" },
          KeyName: { "Fn::If": ["HasKeyName", { Ref: "KeyName" }, { Ref: "AWS::NoValue" }] },
          MetadataOptions: {
            HttpEndpoint: "enabled",
            HttpPutResponseHopLimit: 1,
            HttpTokens: "required",
            InstanceMetadataTags: "enabled"
          },
          Monitoring: { "Fn::If": ["UseDetailedMonitoring", true, false] },
          NetworkInterfaces: [
            {
              AssociatePublicIpAddress: true,
              DeleteOnTermination: true,
              DeviceIndex: "0",
              GroupSet: [{ Ref: "ServerSecurityGroup" }],
              SubnetId: selectedSubnetId
            }
          ],
          Tags: [
            { Key: "Name", Value: "edge-results-benchmark" },
            { Key: "Project", Value: "edge-results-benchmark" },
            { Key: "DataClassification", Value: "synthetic-only" }
          ],
          UserData: {
            "Fn::Base64": {
              "Fn::Sub": createEc2BootstrapUserData()
            }
          }
        }
      }
    },
    Outputs: {
      ApiBaseUrl: {
        Description: "Traditional benchmark base URL",
        Value: { "Fn::Sub": "http://${BenchmarkInstance.PublicIp}:3001" }
      },
      InstanceId: { Value: { Ref: "BenchmarkInstance" } },
      NetworkMode: {
        Description: "Whether the stack used caller-supplied or stack-managed networking",
        Value: { "Fn::If": ["UseProvidedNetwork", "provided", "managed"] }
      },
      PublicDnsName: { Value: { "Fn::GetAtt": ["BenchmarkInstance", "PublicDnsName"] } },
      PublicIp: { Value: { "Fn::GetAtt": ["BenchmarkInstance", "PublicIp"] } },
      SshCommand: {
        Description: "SSH command when a key pair was supplied",
        Value: {
          "Fn::If": [
            "HasKeyName",
            { "Fn::Sub": "ssh -i /path/to/private-key.pem ec2-user@${BenchmarkInstance.PublicDnsName}" },
            "SSH not enabled"
          ]
        }
      },
      SsmCommand: {
        Description: "Connect without opening SSH",
        Value: { "Fn::Sub": "aws ssm start-session --target ${BenchmarkInstance} --region ${AWS::Region}" }
      }
    }
  };
}
