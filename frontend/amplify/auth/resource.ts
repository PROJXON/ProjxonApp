import { defineAuth } from '@aws-amplify/backend';
import { preSignUpUniqueUsername } from '../functions/preSignUpUniqueUsername/resource';
import { postConfirmationUpsertUser } from '../functions/postConfirmationUpsertUser/resource';

/**
 * Define and configure your auth resource
 * @see https://docs.amplify.aws/gen2/build-a-backend/auth
 */
export const auth = defineAuth({
  loginWith: { email: true },
  triggers: {
    preSignUp: preSignUpUniqueUsername,
    postConfirmation: postConfirmationUpsertUser,
  },
  userAttributes: {
    preferredUsername: {
      mutable: true,
      required: true
    }
  }
});
