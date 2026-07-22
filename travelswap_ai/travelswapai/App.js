import './lib/polyfills';
import './lib/webAlert';
import * as Linking from 'expo-linking';
import React, { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import 'react-native-gesture-handler';
import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator, Text } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { theme } from './lib/theme';
import { StatusBar } from 'expo-status-bar';
import HeaderLogo from './components/HeaderLogo';
import OfferFlow from './screens/OfferFlow';
import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import ResetPasswordScreen from './screens/ResetPasswordScreen';
import MainTabs from './screens/MainTabs';
import CreateListingScreen from './screens/CreateListingScreen';
import OAuthCallbackScreen from './screens/OAuthCallbackScreen';
import ProfileScreen from './screens/ProfileScreen';
import EditProfileScreen from './screens/EditProfileScreen';
import OfferDetailScreen from './screens/OfferDetailScreen';
import ListingDetailScreen from './screens/ListingDetailScreen';
import SellerProfileScreen from './screens/SellerProfileScreen';
import SavedScreen from './screens/SavedScreen';
import ChainProposalsScreen from './screens/ChainProposalsScreen';
import SavedSearchesScreen from './screens/SavedSearchesScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import MatchingScreen from './screens/MatchingScreen';
import LinkMessengerScreen from './screens/LinkMessengerScreen';
import ChatScreen from './screens/ChatScreen';
import PreferencesOnboardingScreen from './screens/PreferencesOnboardingScreen';
import { AuthProvider, useAuth } from './lib/auth';
import { NotificationsProvider } from './lib/NotificationsContext';
import { useNeedsPreferencesOnboarding } from './lib/preferences';
import { I18nProvider } from './lib/i18n';
import Constants from "expo-constants";
import { useFonts, PlusJakartaSans_600SemiBold, PlusJakartaSans_700Bold, PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans';

const Stack = createNativeStackNavigator();

// Rete di sicurezza per errori imprevisti: prima mostrava una pagina
// bianca senza alcun indizio (return null) — un crash reale (mancanza
// di SafeAreaProvider) è passato inosservato per giorni proprio perché
// non c'era nulla da vedere né da segnalare. Ora almeno si capisce che
// qualcosa si è rotto, invece di sembrare che l'app non si carichi.
class ErrorBoundary extends React.Component {
  state = { error: null };
  componentDidCatch(error, info) {
    console.error("[ErrorBoundary]", error, info);
    this.setState({ error });
  }
  render() {
    if (this.state.error) {
      return (
        <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: theme.colors.background }}>
          <Text style={{ fontSize: 40, marginBottom: 12 }}>⚠️</Text>
          <Text style={{ fontSize: 18, fontWeight: "800", color: theme.colors.text, textAlign: "center", marginBottom: 8 }}>
            Qualcosa è andato storto
          </Text>
          <Text style={{ fontSize: 14, color: theme.colors.textMuted, textAlign: "center" }}>
            Ricarica la pagina. Se il problema continua, segnalalo con questo messaggio: {String(this.state.error?.message || this.state.error).slice(0, 200)}
          </Text>
        </View>
      );
    }
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
      ResetPassword: 'auth/reset',
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
    <NotificationsProvider>
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
          <Stack.Screen name="SellerProfile" component={SellerProfileScreen} options={{ title: "Venditore" }} />
          <Stack.Screen name="OfferDetail" component={OfferDetailScreen} options={{ title: "Offer" }} />
          <Stack.Screen name="Saved" component={SavedScreen} options={{ title: "Preferiti" }} />
          <Stack.Screen name="ChainProposals" component={ChainProposalsScreen} options={{ title: "Scambi a 3" }} />
          <Stack.Screen name="SavedSearches" component={SavedSearchesScreen} options={{ title: "Avvisi di ricerca" }} />
          <Stack.Screen name="Notifications" component={NotificationsScreen} options={{ title: "Notifiche" }} />
          <Stack.Screen name="EditPreferences" options={{ title: "Le tue preferenze" }}>
            {(props) => (
              <PreferencesOnboardingScreen {...props} mode="edit" onDone={() => props.navigation.goBack()} />
            )}
          </Stack.Screen>
          <Stack.Screen name="Matching" component={MatchingScreen} options={{ title: "Suggeriti dall'AI" }} />
          <Stack.Screen name="LinkMessenger" component={LinkMessengerScreen} options={{ title: "Collega Messenger" }} />
          <Stack.Screen name="Chat" component={ChatScreen} options={{ title: "Chat" }} />
        </>
      ) : (
        <>
          {/* Login per primo (non Onboarding): quando lo Stack.Navigator
              ricalcola le route disponibili per un cambio di `session` e
              nessuna route della schermata attiva sopravvive (es. si era
              su Profile e si fa logout), react-navigation ripiega sulla
              PRIMA Stack.Screen dichiarata in questo elenco — non su
              initialRouteName, che viene fissato una sola volta al primo
              render del Navigator e resta "congelato" da lì in poi. Con
              Onboarding per primo, un logout da una schermata profonda
              finiva lì invece che su Login. */}
          <Stack.Screen name="Login" component={LoginScreen} options={{ title: "Accedi" }} />
          <Stack.Screen name="Onboarding" component={OnboardingScreen} options={{ headerShown: false }} />
          <Stack.Screen name="OAuthCallback" component={OAuthCallbackScreen} options={{ title: "Accesso…" }} />
          <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ title: "Password dimenticata" }} />
        </>
      )}
      {/* Fuori dal ramo session/no-session, e dichiarata PER ULTIMA (non
          per prima): il link di reset password stabilisce una sessione di
          recupero mentre lo schermo è aperto, e se questa route esistesse
          solo in uno dei due rami il flip di `session` la smonterebbe
          subito. Essendo comunque sempre presente, il nome "ResetPassword"
          sopravvive al ricalcolo delle route quando è lo screen
          attivo — ma se fosse la PRIMA dichiarata, diventerebbe lei stessa
          il ripiego di cui sopra per QUALUNQUE cambio di sessione (anche
          un logout da tutt'altra schermata), che è il bug osservato. */}
      <Stack.Screen name="ResetPassword" component={ResetPasswordScreen} options={{ title: "Nuova password" }} />
    </Stack.Navigator>
    </NotificationsProvider>
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
      <SafeAreaProvider>
        <AuthProvider>
          <I18nProvider>
            <NavigationContainer theme={navTheme} linking={linking}>
              <StatusBar style="dark" />
              <RootNavigator />
            </NavigationContainer>
          </I18nProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}
