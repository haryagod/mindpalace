import * as cdk from 'aws-cdk-lib/core';
import { Construct } from 'constructs';
import { FileProcessorStack } from './stacks/FileProcessor';
export class App extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    var filestack = new FileProcessorStack(this, "FileProcess",{ bucketName: 'mindpalace-bucket', identifier: 'file-processor' });

  }
}