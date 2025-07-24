import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View } from 'react-native';

export default function App(): React.JSX.Element {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome to Projxon!</Text>
      <Text style={styles.subtitle}>React Native + TypeScript + Expo</Text>
      <Text style={styles.features}>📱 LinkedIn Integration</Text>
      <Text style={styles.features}>📋 Contact Forms</Text>
      <Text style={styles.features}>📊 ROI Calculator</Text>
      <Text style={styles.features}>📝 Blog Content</Text>
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
});
