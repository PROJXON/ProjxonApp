import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Button } from 'react-native';

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
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Projxon!</Text>
      <Text style={styles.subtitle}>React Native + TypeScript + Expo</Text>
      <Text style={styles.features}>📱 LinkedIn Integration</Text>
      <Text style={styles.features}>📋 Contact Forms</Text>
      <Text style={styles.features}>📊 ROI Calculator</Text>
      <Text style={styles.features}>📝 Blog Content</Text>

      <Authenticator.Provider>
        <Authenticator>
          <SignOutButton />
        </Authenticator>
      </Authenticator.Provider>

      <StatusBar style="auto" />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    marginBottom: 10,
    color: '#333',
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
    marginBottom: 30,
  },
  features: {
    fontSize: 14,
    color: '#555',
    marginVertical: 2,
  },
  signOutButton: {
    alignSelf: 'flex-end',
  },
});
