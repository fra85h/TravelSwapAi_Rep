import './lib/polyfills';
import { fetchJson } from "./lib/backendApi";
import * as Linking from 'expo-linking';
import React from 'react';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import { theme } from './lib/theme';
import { StatusBar } from 'expo-status-bar';
import OfferFlow from './screens/OfferFlow';
import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import MainTabs from './screens/MainTabs';
import CreateListingScreen from './screens/CreateListingScreen';
import OAuthCallbackScreen from './screens/OAuthCallbackScreen';
import ProfileScreen from './screens/ProfileScreen';
import EditProfileScreen from './screens/EditProfileScreen';
import OfferDetailScreen from './screens/OfferDetailScreen';
import ListingDetailScreen from './screens/ListingDetailScreen';
import { AuthProvider, useAuth } from './lib/auth';
import { I18nProvider } from './lib/i18n';
import Constants from "expo-constants";
const Stack = createNativeStackNavigator();
class ErrorBoundary extends React.Component {
  state = { error: null };
  componentDidCatch(error, info) {
    console.log("[ErrorBoundary]", error, info);
    this.setState({ error });
  }
  render() {
    if (this.state.error) return null; // o un fallback <Text>Errore</Text>
    return this.props.children;
  }
}
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

// Deep link + callback per OAuth
const linking = {
  prefixes: [
    Linking.createURL('/'),           // exp://... durante dev
    'travelswapai://',                // scheme nativo
    ...(typeof window !== 'undefined' && window.location?.origin
      ? [window.location.origin + '/']
      : []),
  ],
  config: {
    screens: {
      OAuthCallback: 'auth/callback',
    },
  },
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
          <Stack.Screen name="OAuthCallback" component={OAuthCallbackScreen} options={{ title: "Accesso…" }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Password dimenticata" }} />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  
console.log("[WHOAMI] owner =", Constants.expoConfig?.owner, "slug =", Constants.expoConfig?.slug, "name =", Constants.expoConfig?.name);

  return (
    <ErrorBoundary>
    <AuthProvider>
      <I18nProvider>
        <NavigationContainer theme={navTheme} linking={linking}>
          <StatusBar style="dark" />
          <RootNavigator />
        </NavigationContainer>
      </I18nProvider>
    </AuthProvider>
        </ErrorBoundary>
  );
}
