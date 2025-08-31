import './lib/polyfills';
import { fetchJson } from "./lib/backendApi";

import React, { useEffect, useState } from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import { theme } from './lib/theme';
import { StatusBar } from 'expo-status-bar';
import AsyncStorage from '@react-native-async-storage/async-storage';

import OfferFlow from './screens/OfferFlow';
import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import MainTabs from './screens/MainTabs';
import CreateListingScreen from './screens/CreateListingScreen';
import ProfileScreen from './screens/ProfileScreen';
import EditProfileScreen from './screens/EditProfileScreen';
import OfferDetailScreen from './screens/OfferDetailScreen';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider, useI18n } from './lib/i18n';
import ListingDetailScreen from './screens/ListingDetailScreen';

const Stack = createNativeStackNavigator();

const navTheme = {
  ...DefaultTheme,
  colors: {
    ...DefaultTheme.colors,
    background: theme.colors.background,
    card: theme.colors.surface,
    text: theme.colors.text,
    border: theme.colors.border,
    primary: theme.colors.primary,
  }
};

function RootNavigator() {
  const { session, loading } = useAuth();

  if (loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <Stack.Navigator
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        headerTitleStyle: { fontWeight: "800" },
        contentStyle: { backgroundColor: theme.colors.background },
      }}
    >
      {session ? (
        <>
          <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="CreateListing" component={CreateListingScreen} options={{ title: "Nuovo annuncio" }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profilo" }} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: "Modifica profilo" }} />
          <Stack.Screen name="OfferFlow" component={OfferFlow} options={{ title: "Offerta" }} />
              <Stack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ title: "Listing" }} />
          <Stack.Screen name="OfferDetail" component={OfferDetailScreen} options={{ title: "Offer" }} />
        </>
      ) : (
        <>
          <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Accedi" }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <I18nProvider>
        <NavigationContainer theme={navTheme}>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </I18nProvider>
    </AuthProvider>
  );
}
