import { App } from "aws-cdk-lib";
import { DbReaderStack } from "./stack.js";

const app = new App();
new DbReaderStack(app, "DbReaderStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: "ap-southeast-2",
  },
});
app.synth();
