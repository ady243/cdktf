import { App, AssetType, TerraformAsset, TerraformOutput, TerraformStack } from "cdktf";
import { Construct } from "constructs";
import * as path from "path";

import * as aws from "@cdktf/provider-aws";
import { Vpc } from "@cdktf/provider-aws/lib/vpc";
import * as random from "@cdktf/provider-random";

interface LambdaFunctionConfig {
  path: string,
  handler: string,
  runtime: string,
  stageName: string,
  version: string,

};

const lambdaRolePolicy = {
  "Version": "2012-10-17",
  "Statement": [
    {
      "Action": "sts:AssumeRole",
      "Principal": {
        "Service": "lambda.amazonaws.com"
      },
      "Effect": "Allow",
      "Sid": ""
    }
  ]
};

class LambdaStack extends TerraformStack {
  constructor(scope: Construct, name: string, config: LambdaFunctionConfig) {
    super(scope, name);

    new aws.provider.AwsProvider(this, "aws", {
      region: "eu-west-1",
    });

    new random.provider.RandomProvider(this, "random");

    const vpc = new Vpc(this,"vpc",{
      cidrBlock:"10.0.0.0/16",
      enableDnsSupport:true,
      enableDnsHostnames:true,
    }) 
    const subnet1 = new aws.subnet.Subnet(this,"subnet1",{
      vpcId:vpc.id,
      availabilityZone:"eu-west-1a",
      cidrBlock:"10.0.0.0/24",
      mapPublicIpOnLaunch:false,

    })
    const subnet2 = new aws.subnet.Subnet(this, "subnet2", {
      vpcId: vpc.id,
      availabilityZone: "eu-west-1b",
      cidrBlock: "10.0.1.0/24",
      mapPublicIpOnLaunch: false,

    })
    const subnet3 = new aws.subnet.Subnet(this, "subnet3", {
      vpcId: vpc.id,
      availabilityZone: "eu-west-1c",
      cidrBlock: "10.0.2.0/24",
      mapPublicIpOnLaunch: false,
    })

    const subnetGroup = new aws.dbSubnetGroup.DbSubnetGroup(this,"subnetGroup",{
      name: `board-${name}-db-group`,
      subnetIds: [subnet1.id,subnet2.id,subnet3.id]
    })
    const dbParameter = new aws.dbParameterGroup.DbParameterGroup(this,"dbParameter",{
      name: `board-${name}-parameter`,
      family:"postgres14"
    })

    const dbPassword = new random.password.Password(this,"sbPassword",{
      length:16,
      special:true,
      overrideSpecial:"@"
    })

    const lambdaSecurityGroup = new aws.securityGroup.SecurityGroup(this,"lambdaSecurityGroup",{
      name: `board-${name}-lambdaSecurityGroup`,
      vpcId:vpc.id,
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],

    })

    const dbSecurityGroup = new aws.securityGroup.SecurityGroup(this,"dbSecurityGroup",{
      name: `board-${name}-dbSecurityGroup`,
      vpcId:vpc.id,
      egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
      ingress: [{ protocol: "tcp", fromPort: 5432, toPort: 5432, securityGroups: [lambdaSecurityGroup.id] }] 
    })

    const db = new aws.dbInstance.DbInstance(this,"db",{
      identifier: `board-${name}-db`,
      multiAz:false,
      instanceClass:"db.t4g.micro",
      allocatedStorage:10,
      storageEncrypted:true,
      dbSubnetGroupName:subnetGroup.name,
      vpcSecurityGroupIds: [dbSecurityGroup.id],
      dbName:"postgres",
      username:"postgres",
      password:dbPassword.result,
      port:5432,
      engine:"postgres",
      engineVersion:"14.6",
      parameterGroupName:dbParameter.name,
      backupRetentionPeriod:7,
      skipFinalSnapshot:true,
      applyImmediately:true,
    })

    


    

    const pet = new random.pet.Pet(this, "random-name", {
      length: 2,
    });


    const asset = new TerraformAsset(this, "lambda-asset", {
      path: path.resolve(__dirname, config.path),
      type: AssetType.ARCHIVE, 
    });


  

    const bucket = new aws.s3Bucket.S3Bucket(this, "bucket", {
      bucketPrefix: `board-${name}`,
    });

  
    const lambdaArchive = new aws.s3Object.S3Object(this, "lambda-archive", {
      bucket: bucket.bucket,
      key: `${config.version}/${asset.fileName}`,
      source: asset.path, 
    });

    const role = new aws.iamRole.IamRole(this, "lambda-exec", {
      name: `board-${name}-${pet.id}`,
      assumeRolePolicy: JSON.stringify(lambdaRolePolicy)
    });


    new aws.iamRolePolicyAttachment.IamRolePolicyAttachment(this, "lambda-managed-policy", {
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole',
      role: role.name
    });

    new aws.iamRolePolicyAttachment.IamRolePolicyAttachment(this, "lambda-managed-attachement", {
      policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
      role: role.name
    });
    
    const lambdaFunc = new aws.lambdaFunction.LambdaFunction(this, "board-lambda", {
      functionName: `board-${name}-${pet.id}`,
      timeout:600,
      s3Bucket: bucket.bucket,
      s3Key: lambdaArchive.key,
      handler: config.handler,
      runtime: config.runtime,
      role: role.arn,
      vpcConfig:{subnetIds:[subnet1.id,subnet2.id,subnet3.id],securityGroupIds:[lambdaSecurityGroup.id]},
      environment: {
        variables: {
          DB_URL: db.address,
          DB_PORT: db.port.toString(),
          DB_PASSWORD: dbPassword.result, 
        }}
    });


    const api = new aws.apigatewayv2Api.Apigatewayv2Api(this, "api-gw", {
      name: name,
      protocolType: "HTTP",
      target: lambdaFunc.arn
    });

  

    new aws.lambdaPermission.LambdaPermission(this, "apigw-lambda", {
      functionName: lambdaFunc.functionName,
      action: "lambda:InvokeFunction",
      principal: "apigateway.amazonaws.com",
      sourceArn: `${api.executionArn}/*/*`,
    });

    new TerraformOutput(this, 'url', {
      value: api.apiEndpoint
    });
  }
};

const app = new App();

new LambdaStack(app, 'job-board2k23', {
  path: "../job-board/outJs",
  handler: "index.handler",
  runtime: "nodejs14.x",
  stageName: "job-board",
  version: "v0.0.2"
});

app.synth();
