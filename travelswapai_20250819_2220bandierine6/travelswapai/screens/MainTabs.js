// screens/MainTabs.js
import React from "react";
import { View } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

import HomeScreen from "./HomeScreen";
import OffersScreen from "./OffersScreen";
import MatchingScreen from "./MatchingScreen";
import ProfileScreen from "./ProfileScreen";

// i18n
import { useI18n } from "../lib/i18n";

const Tab = createBottomTabNavigator();
const TAB_BAR_HEIGHT = 64;

export default function MainTabs() {
  const { t } = useI18n();

  return (
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={{
          headerShown: true,
          tabBarStyle: { height: TAB_BAR_HEIGHT },
          tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={() => ({
            // header e label coerenti con translations
            title: t("tabs.home", "Home"),
            headerTitle: t("tabs.home", "Home"),
            tabBarLabel: t("tabs.home", "Home"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "albums" : "albums-outline"} color={color} size={size} />
            ),
          })}
        />

        <Tab.Screen
          name="Offers"
          component={OffersScreen}
          options={() => ({
            title: t("offers.title", "Offerte"),
            // L'OffersScreen sovrascrive dinamicamente l'header con Ricevute/Inviate.
            headerTitle: t("offers.title", "Offerte"),
            tabBarLabel: t("offers.title", "Offerte"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "chatbox" : "chatbox-outline"} color={color} size={size} />
            ),
          })}
        />

        <Tab.Screen
          name="Matching"
          component={MatchingScreen}
          options={() => ({
            title: t("matching.title", "Matching"),
            headerTitle: t("matching.title", "Matching"),
            tabBarLabel: t("matching.title", "Matching"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "sparkles" : "sparkles-outline"} color={color} size={size} />
            ),
          })}
        />

        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={() => ({
            title: t("profile.title", "Profilo"),
            headerTitle: t("profile.title", "Profilo"),
            tabBarLabel: t("profile.title", "Profilo"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "person" : "person-outline"} color={color} size={size} />
            ),
          })}
        />
      </Tab.Navigator>
    </View>
  );
}
