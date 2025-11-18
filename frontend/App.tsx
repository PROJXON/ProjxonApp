import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Button } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ChatScreen from './src/screens/ChatScreen';

import { Amplify } from "aws-amplify";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react-native";

import 'react-native-get-random-values'
import 'react-native-url-polyfill/auto'

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const outputs = require('./amplify_outputs.json');
  Amplify.configure(outputs);
} catch {
  // amplify_outputs.json not present yet; run `npx ampx sandbox` to generate it.
}

const SignOutButton = () => {
  const { signOut } = useAuthenticator();

  return (
    <View style={styles.signOutButton}>
      <Button title="Sign Out" onPress={signOut} />
    </View>
  );
};

export default function App(): React.JSX.Element {
  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.container}>
        <Authenticator.Provider>
          <Authenticator
            loginMechanisms={['email']}
            signUpAttributes={['preferred_username']}
          >
            <View style={{ flex: 1, alignSelf: 'stretch' }}>
              <SignOutButton />
              <View style={{ flex: 1 }}>
                <ChatScreen />
              </View>
            </View>
          </Authenticator>
        </Authenticator.Provider>

        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
  },
  signOutButton: {
    alignSelf: 'flex-end',
  },
});
