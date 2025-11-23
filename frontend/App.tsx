import React, { useState } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Button, TextInput, Pressable } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import ChatScreen from './src/screens/ChatScreen';

import { Amplify } from "aws-amplify";
import { Authenticator, useAuthenticator } from "@aws-amplify/ui-react-native";
import { fetchUserAttributes } from 'aws-amplify/auth';

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

const MainAppContent = () => {
  const { user } = useAuthenticator();
  const [displayName, setDisplayName] = useState<string>('anon');
  React.useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const attrs = await fetchUserAttributes();
        const name =
          (attrs.preferred_username as string | undefined) ||
          (attrs.email as string | undefined) ||
          (user as any)?.username ||
          'anon';
        if (mounted) setDisplayName(name);
      } catch {
        if (mounted) setDisplayName((user as any)?.username || 'anon');
      }
    })();
    return () => {
      mounted = false;
    };
  }, [user]);

  const currentUsername =
    (displayName.length ? displayName : (
      (user as any)?.username as string | undefined || 'anon'
    ));

  const [conversationId, setConversationId] = useState<string>('global');
  const [peer, setPeer] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState<boolean>(false);
  const [peerInput, setPeerInput] = useState<string>('');
  const [searchError, setSearchError] = useState<string | null>(null);

  return (
    <View style={styles.appContent}>
      <View style={styles.topRow}>
        <Button title="Direct Message" onPress={() => setSearchOpen((prev) => !prev)} />
        <Button
          title="Global"
          onPress={() => {
            setConversationId('global');
            setPeer(null);
            setPeerInput('');
            setSearchError(null);
            setSearchOpen(false);
          }}
        />
        <SignOutButton />
      </View>
      {searchOpen && (
        <View style={styles.searchRow}>
            <TextInput
              value={peerInput}
              onChangeText={(value) => {
                setPeerInput(value);
                setSearchError(null);
              }}
              placeholder="User to Message"
              style={styles.searchInput}
            />
                  <Button
                    title="Start DM"
                    onPress={() => {
                      const trimmed = peerInput.trim();
                      const normalizedInput = trimmed.toLowerCase();
                      const normalizedCurrent = currentUsername.trim().toLowerCase();
                      console.log(normalizedCurrent, normalizedInput)
                      if (!trimmed || normalizedInput === normalizedCurrent) {
                        setSearchError(
                          normalizedInput === normalizedCurrent ? 'Not you silly!' : 'Enter a username'
                        );
                        return;
                      }
                      const id = [normalizedCurrent, normalizedInput].sort().join('#');
                      setPeer(trimmed);
                      setConversationId(id);
                      setSearchOpen(false);
                      setPeerInput('');
                      setSearchError(null);
                    }}
                  />
            <Button
              title="Cancel"
              onPress={() => {
                setSearchOpen(false);
                setPeerInput('');
                setSearchError(null);
              }}
            />
        </View>
      )}
      {searchError ? <Text style={styles.errorText}>{searchError}</Text> : null}
      <View style={{ flex: 1 }}>
        <ChatScreen conversationId={conversationId} peer={peer} displayName={displayName} />
      </View>
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
            <MainAppContent />
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
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    marginBottom: 8,
    gap: 8,
    zIndex: 1,
  },
  searchInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 8,
    paddingHorizontal: 10,
    height: 40,
  },
  errorText: {
    color: '#d32f2f',
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  appContent: {
    flex: 1,
    alignSelf: 'stretch',
    position: 'relative',
  },
});
