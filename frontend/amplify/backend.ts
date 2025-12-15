import { defineBackend, defineStorage } from '@aws-amplify/backend';
import { auth } from './auth/resource';

/**
 * @see https://docs.amplify.aws/react/build-a-backend/ to add storage, functions, and more
 */
const storage = defineStorage({
  name: 'chatMedia',
  access: (allow) => ({
    'global/*': [allow.authenticated.to(['read', 'write'])],
  }),
});

defineBackend({
  auth,
  storage,
});
