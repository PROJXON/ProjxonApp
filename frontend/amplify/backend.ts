import { defineBackend } from '@aws-amplify/backend';
import { auth } from './auth/resource';
import { storage } from './storage/resource';
import { PolicyStatement } from 'aws-cdk-lib/aws-iam';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
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

// ---- CloudFront CDN in front of Storage bucket (public media) ----
// We serve public channel media + avatars via CloudFront for speed/caching.
// DM media is served via CloudFront too, but requires Signed URLs (trusted key group).
const mediaBucket = backend.storage.resources.bucket;
// IMPORTANT:
// Put the Distribution in the *same* nested stack as the bucket to avoid
// circular dependencies between nested stacks (CloudFront OAC adds a bucket policy).
const cdnScope = mediaBucket.stack;
const s3Origin = origins.S3BucketOrigin.withOriginAccessControl(mediaBucket);

// ---- DM CloudFront signing (trusted key group) ----
// We DO NOT commit any keys. For sandbox, pass the public key PEM via env var:
//
//   $env:DM_CLOUDFRONT_PUBLIC_KEY_PEM = "-----BEGIN PUBLIC KEY-----`n...`n-----END PUBLIC KEY-----"
//   npx ampx sandbox
//
// If not provided, DM behavior is NOT created (so public media deploys fine).
const DM_CLOUDFRONT_PUBLIC_KEY_PEM = String(process.env.DM_CLOUDFRONT_PUBLIC_KEY_PEM || '').trim();
const dmPublicKey = DM_CLOUDFRONT_PUBLIC_KEY_PEM
  ? new cloudfront.PublicKey(cdnScope, 'DmMediaPublicKey', {
      encodedKey: DM_CLOUDFRONT_PUBLIC_KEY_PEM,
      comment: 'Projxon DM media signer',
    })
  : null;
const dmKeyGroup = dmPublicKey
  ? new cloudfront.KeyGroup(cdnScope, 'DmMediaKeyGroup', {
      items: [dmPublicKey],
      comment: 'Projxon DM media key group',
    })
  : null;

const cdn = new cloudfront.Distribution(cdnScope, 'MediaCdn', {
  defaultBehavior: {
    origin: s3Origin,
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
  },
  additionalBehaviors: {
    // Public channel media (including thumbs)
    '/uploads/channels/*': {
      origin: s3Origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },
    // Public avatars
    '/uploads/public/*': {
      origin: s3Origin,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
      cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
    },

    ...(dmKeyGroup
      ? {
          // Private DM media (encrypted). Requires CloudFront signed URL/cookie.
          '/uploads/dm/*': {
            origin: s3Origin,
            viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
            allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
            cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
            trustedKeyGroups: [dmKeyGroup],
          },
        }
      : {}),
  },
});

backend.addOutput({
  custom: {
    cdnUrl: `https://${cdn.domainName}`,
    ...(dmPublicKey ? { dmKeyPairId: dmPublicKey.publicKeyId } : {}),
  },
});
