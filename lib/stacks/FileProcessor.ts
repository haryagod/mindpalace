import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { PythonLambda } from '../../constructs/python_lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as apigw from 'aws-cdk-lib/aws-apigateway';

interface FileProcessorStackProps extends cdk.StackProps {
    bucketName: string;
    identifier:string;
}

export class FileProcessorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: FileProcessorStackProps) {
    super(scope, id, props);



    const { identifier, bucketName } = props;
        const domainName = identifier;

    var lambdarole = new iam.Role(this, 'lambdarole', {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
     description: 'Role assumed by API Gateway to call OpenSearch',
    });

    lambdarole.addManagedPolicy(
    iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole")
  );
    
    const bucket = new s3.Bucket(this, bucketName, {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      bucketName: props.bucketName,
      autoDeleteObjects: true,
    });


      bucket.addCorsRule({
      allowedOrigins: ['*'], // dev frontend
      allowedMethods: [
        s3.HttpMethods.GET,
        s3.HttpMethods.PUT,
        s3.HttpMethods.POST,
      ],
      allowedHeaders: ['*'],
      exposedHeaders: ['ETag'],
    });

    // Create OpenSearch Domain
    const domain = new opensearch.Domain(this, `${domainName}`, {
      domainName: domainName,
      version: opensearch.EngineVersion.OPENSEARCH_2_9,
      capacity: {
        dataNodeInstanceType: 't3.small.search',
        dataNodes: 1,
        multiAzWithStandbyEnabled: false
      },
      ebs: {
        volumeSize: 10,
        volumeType: ec2.EbsDeviceVolumeType.GP2,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      enforceHttps: true,
      nodeToNodeEncryption: true,
      encryptionAtRest: { enabled: true },
      fineGrainedAccessControl: {
      masterUserArn: lambdarole.roleArn,
      },
      // Optional: allow open access for dev
      accessPolicies: [
        new cdk.aws_iam.PolicyStatement({
          actions: ['es:*'],
          principals: [new cdk.aws_iam.ArnPrincipal(lambdarole.roleArn)],
          resources: [ `arn:aws:es:${this.region}:${this.account}:domain/${domainName}/*`],
        }),
      ],
    });


  lambdarole.addToPrincipalPolicy(new iam.PolicyStatement({
  effect: iam.Effect.ALLOW,
  actions: [
    "es:*"
  ],
    resources: [`${domain.domainArn}/*`]
  }));

    // SSM Parameter to store endpoint
    new ssm.StringParameter(this, 'OpenSearchEndpointParam', {
      parameterName: `/mindpalace/${domainName}/opensearch-endpoint`,
      stringValue: domain.domainEndpoint,
      description: `OpenSearch endpoint for MindPalace ${domainName}`,
      tier: ssm.ParameterTier.STANDARD,
    });

    const table = new dynamodb.Table(this, 'MetadataTable', {
      partitionKey: { name: 'fileKey', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    // Lambda Environment
    const env = {
      OPENSEARCH_ENDPOINT: domain.domainEndpoint, // Replace with your domain endpoint
      INDEX_NAME: 'file-embeddings',
      METADATA_TABLE: table.tableName,
      BUCKET_NAME: bucket.bucketName
    };

    //   const tesseractLayer = new lambda.LayerVersion(this, 'TesseractLayer', {
    //       code: lambda.Code.fromAsset(
    //         path.join(__dirname, '../lambda/layers/textract')
    //       ),
    //       compatibleRuntimes: [lambda.Runtime.PYTHON_3_13],
    //       description: 'Tesseract OCR layer (Amazon Linux 2)',
    //       layerVersionName: 'tesseract-ocr',
    //     });

    const fileLambda = new PythonLambda(this, 'FileProcessorLambda', {
      entry: '../lambda/fileprocesss', // path to your Lambda folder with handler.py
      handler: 'conversion.lambda_handler',
      functionName: 'FileProcessorLambda',
      memorySize: 256,
      role: lambdarole,
      timeoutMinutes: 10,
      environment: env,
    });

    // Permissions
    bucket.grantReadWrite(fileLambda.Fn); // S3
    table.grantReadWriteData(fileLambda.Fn);    // DynamoDB

    // Bedrock permission
    fileLambda.Fn.addToRolePolicy(new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: ['*'],
    }));
// API Gateway
const api = new apigw.RestApi(this, 'FileApi',{
 defaultCorsPreflightOptions: {
        allowOrigins: ['*'], // your frontend domain
        allowMethods: ['OPTIONS', 'POST'],       // methods you need
        allowHeaders: [
          'Content-Type',
          'X-Amz-Date',
          'Authorization',
          'X-Amz-Security-Token',
          'X-Api-Key',
          'X-Amz-User-Agent',
          'x-amz-meta-*'
        ],
      },
});

// /convert route
const convert = api.root.addResource('convert');
convert.addMethod('POST', new apigw.LambdaIntegration(fileLambda.Fn, {
  requestTemplates: {
    'application/json': `{
      mode: 'convert',
      bucket: "$input.json('$.bucket')",
      key: "$input.json('$.key')",
      outputFormat: "$input.json('$.outputFormat')"
    }`
  }
}));

// /search route
const search = api.root.addResource('search');
search.addMethod('POST', new apigw.LambdaIntegration(fileLambda.Fn));

// /search route
const upload = api.root.addResource('upload');
upload.addMethod('POST', new apigw.LambdaIntegration(fileLambda.Fn));

new cdk.CfnOutput(this, "apiurl", {value: api.url})
        bucket.addEventNotification(
          s3.EventType.OBJECT_CREATED,
          new s3n.LambdaDestination(fileLambda.Fn)
        );
  }
}
