import * as apigw from "aws-cdk-lib/aws-apigatewayv2";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Duration, Stack, type StackProps } from "aws-cdk-lib";
import { Architecture, Code, Function, Runtime } from "aws-cdk-lib/aws-lambda";
import { HttpApi } from "aws-cdk-lib/aws-apigatewayv2";
import { HttpLambdaIntegration } from "aws-cdk-lib/aws-apigatewayv2-integrations";
import { CfnOutput } from "aws-cdk-lib";
import { Construct } from "constructs";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = join(fileURLToPath(import.meta.url), "..");
const DIST = join(HERE, "..", "..", "dist");
const SINGLE_ZIP = join(DIST, "bootstrap.zip");
const ARM64_ZIP = join(DIST, "bootstrap-arm64.zip");
const X64_ZIP = join(DIST, "bootstrap-x64.zip");

export class DbReaderStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const region = this.region;
    const account = this.account;

    const bucket = new s3.Bucket(this, "SnapshotsBucket", {
      bucketName: `dbreader-snapshots-${account}-${region}`,
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT],
          allowedOrigins: ["*"],
          allowedHeaders: ["*"],
          exposedHeaders: ["ETag"],
        },
      ],
    });

    const table = (name: string, partitionKey: string, sortKey?: string) =>
      new dynamodb.Table(this, `Table-${name}`, {
        tableName: `dbreader-${name}`,
        partitionKey: { name: partitionKey, type: dynamodb.AttributeType.STRING },
        sortKey: sortKey
          ? { name: sortKey, type: dynamodb.AttributeType.STRING }
          : undefined,
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      });

    const users = table("users", "user_id");
    const sessions = table("sessions", "token");
    const teams = table("teams", "team_id");
    const files = table("files", "team_id", "file_id");
    const ops = table("ops", "site_key");

    const codeZip = existsSync(SINGLE_ZIP)
      ? SINGLE_ZIP
      : existsSync(ARM64_ZIP)
        ? ARM64_ZIP
        : X64_ZIP;
    const architecture = existsSync(SINGLE_ZIP)
      ? Architecture.ARM_64
      : existsSync(ARM64_ZIP)
        ? Architecture.ARM_64
        : Architecture.X86_64;

    const fn = new Function(this, "RelayFn", {
      functionName: "dbreader-relay",
      runtime: Runtime.PROVIDED_AL2023,
      handler: "bootstrap",
      architecture,
      code: Code.fromAsset(codeZip),
      timeout: Duration.seconds(60),
      memorySize: 512,
      environment: {
        SNAP_BUCKET: bucket.bucketName,
        USERS_TABLE: users.tableName,
        SESSIONS_TABLE: sessions.tableName,
        TEAMS_TABLE: teams.tableName,
        FILES_TABLE: files.tableName,
        OPS_TABLE: ops.tableName,
      },
    });

    users.grantReadWriteData(fn);
    sessions.grantReadWriteData(fn);
    teams.grantReadWriteData(fn);
    files.grantReadWriteData(fn);
    ops.grantReadWriteData(fn);
    bucket.grantPut(fn);
    bucket.grantRead(fn);

    const api = new HttpApi(this, "DbReaderApi", {
      apiName: "dbreader-api",
      corsPreflight: {
        allowOrigins: ["*"],
        allowMethods: [apigw.CorsHttpMethod.GET, apigw.CorsHttpMethod.POST, apigw.CorsHttpMethod.OPTIONS],
        allowHeaders: ["content-type", "authorization"],
      },
    });
    api.addRoutes({
      path: "/{proxy+}",
      methods: [apigw.HttpMethod.ANY],
      integration: new HttpLambdaIntegration("RelayIntegration", fn),
    });

    new CfnOutput(this, "ApiUrl", { value: api.apiEndpoint });
    new CfnOutput(this, "BucketName", { value: bucket.bucketName });
    new CfnOutput(this, "LambdaName", { value: fn.functionName });
    new CfnOutput(this, "Region", { value: region });
  }
}
