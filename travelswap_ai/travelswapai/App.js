import './lib/polyfills';
import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import { theme } from './lib/theme';
import { StatusBar } from 'expo-status-bar';
import HeaderLogo from './components/HeaderLogo';
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
import SavedScreen from './screens/SavedScreen';
import ManageImagesScreen from './screens/ManageImagesScreen';
import ChainProposalsScreen from './screens/ChainProposalsScreen';
import SavedSearchesScreen from './screens/SavedSearchesScreen';
import MatchingScreen from './screens/MatchingScreen';
import PreferencesOnboardingScreen from './screens/PreferencesOnboardingScreen';
import { AuthProvider, useAuth } from './lib/auth';
import { useNeedsPreferencesOnboarding } from './lib/preferences';
import { I18nProvider } from './lib/i18n';
import Constants from "expo-constants";
import { useFonts, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';

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
    'travelswap://',                  // scheme nativo
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
  const { loading: prefsLoading, needsOnboarding, markDone } = useNeedsPreferencesOnboarding(session);

  // Il carosello di presentazione si mostra solo la prima volta: chi lo ha
  // già visto (o fa logout) atterra direttamente sul Login.
  const [seenOnboarding, setSeenOnboarding] = useState(null);
  useEffect(() => {
    AsyncStorage.getItem('hasSeenOnboarding')
      .then((v) => setSeenOnboarding(v === '1'))
      .catch(() => setSeenOnboarding(false));
  }, []);

  if (loading || (session && prefsLoading) || (!session && seenOnboarding === null)) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator />
      </View>
    );
  }

  // Preferenze subito dopo la registrazione (D4): una volta sola per
  // account (profiles.prefs.onboarded), non ad ogni avvio. Renderizzata
  // fuori dal Navigator: niente route da gestire, solo un passaggio
  // intermedio prima di entrare nell'app vera e propria.
  if (session && needsOnboarding) {
    return <PreferencesOnboardingScreen onDone={markDone} />;
  }

  return (
    <Stack.Navigator
      initialRouteName={session ? "MainTabs" : (seenOnboarding ? "Login" : "Onboarding")}
      screenOptions={{
        headerShown: true,
        headerShadowVisible: false,
        // >>> LOGO IN ALTO A SX (usa il tuo componente che legge ../assets/logo.png)
        headerTitle: () => <HeaderLogo />,
        headerTitleAlign: 'left',
        headerTintColor: theme.colors.boardingText,
        headerTitleStyle: { fontWeight: "800", color: theme.colors.boardingText },
        contentStyle: { backgroundColor: theme.colors.background },
        headerBackTitle: "Indietro",          // 👈 forza testo back
    headerTruncatedBackTitle: "Indietro", // 👈 se lo deve accorciare
    headerBackTitleVisible: true,         // 👈 così vedi sempre “Indietr
        //headerBackTitleVisible: false,
      }}
    >
      {session ? (
        <>
          {/* NB: MainTabs tiene il suo header interno: qui rimane nascosto */}
          <Stack.Screen name="MainTabs" component={MainTabs} options={{ headerShown: false }} />
          <Stack.Screen name="CreateListing" component={CreateListingScreen} options={{ title: "Nuovo annuncio" }} />
          <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: "Profilo" }} />
          <Stack.Screen name="EditProfile" component={EditProfileScreen} options={{ title: "Modifica profilo" }} />
          <Stack.Screen name="OfferFlow" component={OfferFlow} options={{ title: "Offerta" }} />
          <Stack.Screen name="ListingDetail" component={ListingDetailScreen} options={{ title: "Listing" }} />
          <Stack.Screen name="OfferDetail" component={OfferDetailScreen} options={{ title: "Offer" }} />
          <Stack.Screen name="Saved" component={SavedScreen} options={{ title: "Preferiti" }} />
          <Stack.Screen name="ManageImages" component={ManageImagesScreen} options={{ title: "Foto annuncio" }} />
          <Stack.Screen name="ChainProposals" component={ChainProposalsScreen} options={{ title: "Scambi a 3" }} />
          <Stack.Screen name="SavedSearches" component={SavedSearchesScreen} options={{ title: "Avvisi di ricerca" }} />
          <Stack.Screen name="Matching" component={MatchingScreen} options={{ title: "Suggeriti dall'AI" }} />
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
  if (__DEV__) console.log("[WHOAMI] owner =", Constants.expoConfig?.owner, "slug =", Constants.expoConfig?.slug, "name =", Constants.expoConfig?.name);

  // Font dei titoli (Plus Jakarta Sans): caricato una volta all'avvio,
  // il testo di sistema resta invariato per tutto il resto dell'app.
  const [fontsLoaded] = useFonts({
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });

  if (!fontsLoaded) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.colors.background }}>
        <ActivityIndicator />
      </View>
    );
  }

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
