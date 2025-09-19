import React from "react";
import { View } from "react-native";
import { theme } from "../lib/theme";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import HeaderLogo from "../components/HeaderLogo";

import HomeScreen from "./HomeScreen";
import OffersScreen from "./OffersScreen";
import MatchingScreen from "./MatchingScreen";
import ProfileScreen from "./ProfileScreen";
import { useI18n } from "../lib/i18n";

const Tab = createBottomTabNavigator();
const TAB_BAR_HEIGHT = 68;

export default function MainTabs() {
  const { t } = useI18n();
  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Tab.Navigator
        screenOptions={{
          headerTitle: () => <HeaderLogo />,
          headerTitleAlign: "left",
          headerTintColor: theme.colors.boardingText,
          tabBarActiveTintColor: theme.colors.boardingText,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: { height: TAB_BAR_HEIGHT },
          tabBarLabelStyle: { paddingBottom: 6, fontWeight: "700" },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: t("home.title", "Annunci"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Offers"
          component={OffersScreen}
          options={{
            tabBarLabel: t("offers.title", "Offerte"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "pricetags" : "pricetags-outline"} color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Matching"
          component={MatchingScreen}
          options={{
            tabBarLabel: t("matching.title", "Matching"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "search" : "search-outline"} color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            tabBarLabel: t("profile.title", "Profilo"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "person" : "person-outline"} color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>
    </View>
  );
}
