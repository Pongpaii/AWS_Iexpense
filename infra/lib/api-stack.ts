import { fileURLToPath } from 'node:url';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import {
  CorsHttpMethod,
  HttpApi,
  HttpMethod,
  HttpStage,
  LogGroupLogDestination,
} from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IUserPool, IUserPoolClient } from 'aws-cdk-lib/aws-cognito';
import type { ITable } from 'aws-cdk-lib/aws-dynamodb';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { ApplicationLogLevel, LoggingFormat, SystemLogLevel } from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction, OutputFormat } from 'aws-cdk-lib/aws-lambda-nodejs';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import {
  API_THROTTLE,
  EXTRA_CORS_ORIGINS,
  LAMBDA_DEFAULTS,
  LOG_RETENTION,
  PROJECT,
} from './config';

export interface ApiStackProps extends StackProps {
  table: ITable;
  userPool: IUserPool;
  userPoolClient: IUserPoolClient;
  /** โดเมน CloudFront (เช่น https://dxxxx.cloudfront.net) — ได้หลัง WebStack (phase 6) */
  webOrigin?: string;
}

const apiSrc = (file: string) =>
  fileURLToPath(new URL(`../../api/src/handlers/${file}`, import.meta.url));

/** HTTP API + JWT authorizer (Cognito) + Lambda (Node 22, arm64, 256MB, 10s, ไม่อยู่ใน VPC) */
export class ApiStack extends Stack {
  readonly api: HttpApi;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const fn = (name: string, entry: string, environment: Record<string, string>) => {
      const logGroup = new LogGroup(this, `${name}Logs`, {
        logGroupName: `/aws/lambda/${PROJECT}-${name.toLowerCase()}`,
        retention: LOG_RETENTION,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      return new NodejsFunction(this, `${name}Fn`, {
        ...LAMBDA_DEFAULTS,
        functionName: `${PROJECT}-${name.toLowerCase()}`,
        entry: apiSrc(entry),
        handler: 'handler',
        environment: { ...environment, NODE_OPTIONS: '--enable-source-maps' },
        logGroup,
        loggingFormat: LoggingFormat.JSON,
        applicationLogLevelV2: ApplicationLogLevel.INFO,
        systemLogLevelV2: SystemLogLevel.WARN,
        bundling: {
          format: OutputFormat.ESM,
          target: 'node22',
          minify: true,
          sourceMap: true,
          // ใช้ AWS SDK v3 ที่มากับ runtime → bundle เล็ก, cold start เร็ว
          externalModules: ['@aws-sdk/*'],
          // ESM ใน Lambda ต้องมี require สำหรับ dependency แบบ CJS
          banner:
            "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
        },
      });
    };

    const apiFn = fn('Api', 'api.ts', { TABLE_NAME: props.table.tableName });
    props.table.grantReadWriteData(apiFn);

    const accountFn = fn('Account', 'account.ts', {
      TABLE_NAME: props.table.tableName,
      USER_POOL_ID: props.userPool.userPoolId,
    });
    props.table.grantReadWriteData(accountFn);
    accountFn.addToRolePolicy(
      new PolicyStatement({
        actions: ['cognito-idp:AdminDeleteUser'],
        resources: [props.userPool.userPoolArn],
      }),
    );

    const allowOrigins = [...(props.webOrigin ? [props.webOrigin] : []), ...EXTRA_CORS_ORIGINS];

    this.api = new HttpApi(this, 'HttpApi', {
      apiName: `${PROJECT}-api`,
      createDefaultStage: false,
      corsPreflight: {
        allowOrigins,
        allowMethods: [
          CorsHttpMethod.GET,
          CorsHttpMethod.POST,
          CorsHttpMethod.PUT,
          CorsHttpMethod.PATCH,
          CorsHttpMethod.DELETE,
          CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: ['authorization', 'content-type'],
        exposeHeaders: ['content-disposition', 'idempotent-replayed'],
        maxAge: Duration.hours(1),
      },
      defaultAuthorizer: new HttpUserPoolAuthorizer('CognitoJwt', props.userPool, {
        userPoolClients: [props.userPoolClient],
      }),
    });

    const accessLogs = new LogGroup(this, 'ApiAccessLogs', {
      logGroupName: `/aws/apigateway/${PROJECT}-api`,
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    new HttpStage(this, 'DefaultStage', {
      httpApi: this.api,
      stageName: '$default',
      autoDeploy: true,
      throttle: API_THROTTLE,
      accessLogSettings: { destination: new LogGroupLogDestination(accessLogs) },
    });

    const apiIntegration = new HttpLambdaIntegration('ApiIntegration', apiFn);
    const routes: [HttpMethod, string][] = [
      [HttpMethod.GET, '/transactions'],
      [HttpMethod.POST, '/transactions'],
      [HttpMethod.PATCH, '/transactions/{id}'],
      [HttpMethod.DELETE, '/transactions/{id}'],
      [HttpMethod.POST, '/transactions/{id}/restore'],
      [HttpMethod.POST, '/transactions/bulk-delete'],
      [HttpMethod.GET, '/summary/balance'],
      [HttpMethod.GET, '/summary/monthly'],
      [HttpMethod.GET, '/settings'],
      [HttpMethod.PUT, '/settings'],
      [HttpMethod.GET, '/achievements'],
      [HttpMethod.POST, '/achievements'],
      [HttpMethod.DELETE, '/achievements'],
      [HttpMethod.GET, '/export'],
    ];
    for (const [method, path] of routes) {
      this.api.addRoutes({ path, methods: [method], integration: apiIntegration });
    }
    this.api.addRoutes({
      path: '/account',
      methods: [HttpMethod.DELETE],
      integration: new HttpLambdaIntegration('AccountIntegration', accountFn),
    });

    new CfnOutput(this, 'ApiUrl', {
      key: 'ViteApiUrl',
      description: 'VITE_API_URL',
      value: this.api.apiEndpoint,
    });
  }
}
