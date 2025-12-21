import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import { preSignUpUniqueUsername } from './functions/preSignUpUniqueUsername/resource';
import { postConfirmationUpsertUser } from './functions/postConfirmationUpsertUser/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const backend = defineBackend({
  auth,
  storage,
  preSignUpUniqueUsername,
  postConfirmationUpsertUser,
});

// ---- Cognito password policy override (Gen2 escape hatch) ----
// Amplify's default is a strong policy (8 chars + upper/lower/number/symbol).
// If you want a simpler dev password policy, override the UserPool L1 here.
//
// NOTE: This is applied by Amplify/CDK deployments. If you only change the policy in the AWS console,
// it may drift from what's deployed.
backend.auth.resources.cfnResources.cfnUserPool.policies = {
  passwordPolicy: {
    minimumLength: 6,
    requireLowercase: false,
    requireUppercase: false,
    requireNumbers: false,
    requireSymbols: false,
    temporaryPasswordValidityDays: 7,
  },
};

// ---- Grant auth triggers access to the Users table (external resource) ----
const usersTableArn = 'arn:aws:dynamodb:us-east-2:503561430481:table/Users';
backend.preSignUpUniqueUsername.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:Query'],
    resources: [usersTableArn, `${usersTableArn}/index/byUsernameLower`],
  })
);
backend.postConfirmationUpsertUser.resources.lambda.addToRolePolicy(
  new PolicyStatement({
    actions: ['dynamodb:PutItem'],
    resources: [usersTableArn],
  })
);
