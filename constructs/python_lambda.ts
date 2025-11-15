import * as path from 'path';
import { Construct } from 'constructs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cdk from 'aws-cdk-lib';
import { IVpc } from 'aws-cdk-lib/aws-ec2';
import { IRole } from 'aws-cdk-lib/aws-iam';

export interface PythonLambdaProps {
  entry: string; // relative path to lambda source folder
  handler: string; // e.g. 'lambda_handler.main'
  environment?: { [key: string]: string };
  layers?: lambda.ILayerVersion[];
  memorySize?: number;
  timeoutMinutes?: number;
  functionName?: string;
  runtime?: lambda.Runtime;
  vpc?: IVpc
  role?: IRole
}

export class PythonLambda extends Construct {
  public readonly Fn: lambda.Function;

  constructor(scope: Construct, id: string, props: PythonLambdaProps) {
    super(scope, id);

    const {
      entry,
      handler,
      functionName,
      vpc,
      environment = {},
      role,
      layers = [],
      memorySize = 512,
      timeoutMinutes = 5,
      runtime = lambda.Runtime.PYTHON_3_13,
    } = props;

    this.Fn = new lambda.Function(this, 'Function', {
      runtime,
      handler,
      memorySize,
      vpc,
      role,
      functionName,
      layers,
      environment,
      timeout: cdk.Duration.minutes(timeoutMinutes),
      code: lambda.Code.fromAsset(path.join(__dirname, entry), {
        bundling: {
          image: runtime.bundlingImage,
          user: 'root',
          command: [
            'sh',
            '-c',
            `
              pip install -r requirements.txt -t /asset-output &&
              cp -au . /asset-output
            `,
          ],
        },
      }),
    });
  }
}