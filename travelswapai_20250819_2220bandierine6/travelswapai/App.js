// 👉 Carica i polyfill PRIMA di tutto (belt & suspenders su Snack)
import './lib/polyfills';
//import RedirectTester from "./screens/redirecttester";

import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import OfferFlow from './screens/OfferFlow';
import OnboardingScreen from './screens/OnboardingScreen';
import LoginScreen from './screens/LoginScreen';
import MainTabs from './screens/MainTabs';
import OfferDetailScreen from './screens/OfferDetailScreen';
import CreateListingScreenWrapper from './screens/CreateListingScreenWrapper';
import MatchingScreen from './screens/MatchingScreen';
import ListingDetailScreen from './screens/ListingDetailScreen';
import EditProfileScreen from './screens/EditProfileScreen';

import { AuthProvider, useAuth } from './lib/auth';
// 👇 aggiunta
import { I18nProvider, useI18n } from './lib/i18n';

const Stack = createNativeStackNavigator();

function RootNavigator() {
  const { session, loading } = useAuth();
  const { t } = useI18n();

  const [hasSeenOnboarding, setHasSeenOnboarding] = useState(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const v = await AsyncStorage.getItem('hasSeenOnboarding');
        if (mounted) setHasSeenOnboarding(v === '1');
      } catch (e) {
        if (mounted) setHasSeenOnboarding(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, []);

  if (loading || hasSeenOnboarding === null) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <Stack.Navigator
      initialRouteName={
        session ? 'MainTabs' : hasSeenOnboarding ? 'Login' : 'Onboarding'
      }
      screenOptions={{ headerShown: true }}>
      {session ? (
        <>
          <Stack.Screen
            name="MainTabs"
            component={MainTabs}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="OfferDetail"
            component={OfferDetailScreen}
            options={{ title: t('stack.offerDetail') }}
          />
          <Stack.Screen
            name="CreateListing"
            component={CreateListingScreenWrapper}
            options={{ title: t('createListing.title') }}
          />
          <Stack.Screen
            name="OfferFlow"
            component={OfferFlow}
            options={{ title: t('stack.offerFlow') }}
          />
          <Stack.Screen
            name="Matching"
            component={MatchingScreen}
            options={{ title: t('stack.matching') }}
          />
          <Stack.Screen
            name="ListingDetail"
            component={ListingDetailScreen}
            options={{ title: t('stack.listingDetail') }}
          />
          <Stack.Screen
            name="EditProfile"
            component={EditProfileScreen}
            options={{ title: t('stack.editProfile') }}
          />
          {/* <Stack.Screen name="RedirectTester" component={RedirectTester} /> */}
        </>
      ) : (
        <>
          <Stack.Screen
            name="Onboarding"
            component={OnboardingScreen}
            options={{ headerShown: false }}
          />
          <Stack.Screen
            name="Login"
            component={LoginScreen}
            options={{ title: t('auth.loginTitle') }}
          />
        </>
      )}
    </Stack.Navigator>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <I18nProvider>
        <NavigationContainer>
          <RootNavigator />
        </NavigationContainer>
      </I18nProvider>
    </AuthProvider>
  );
}
