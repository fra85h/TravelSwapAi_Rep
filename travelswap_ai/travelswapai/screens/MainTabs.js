import React from "react";
import { View } from "react-native";
import { theme } from "../lib/theme";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";

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
    <View style={{ flex: 1 }}>
      <Tab.Navigator
        screenOptions={{
          headerShown: true,
          headerShadowVisible: false,
          headerTitleStyle: { fontWeight: "800", color: theme.colors.text },
          tabBarShowLabel: true,
          tabBarLabelStyle: { fontSize: 12, fontWeight: "700" },
          tabBarActiveTintColor: theme.colors.text,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarHideOnKeyboard: true,
          tabBarStyle: [{
            position: "absolute",
            left: 16, right: 16, bottom: 12,
            height: TAB_BAR_HEIGHT,
            backgroundColor: theme.colors.surface,
            borderRadius: 24,
            borderTopWidth: 0,
            ...theme.shadow.md,
          }],
          tabBarItemStyle: { paddingVertical: 6 },
          tabBarIconStyle: { marginTop: 4 },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={() => ({
            title: t("home.title", "Home"),
            headerTitle: t("home.title", "Home"),
            tabBarLabel: t("home.title", "Home"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "home" : "home-outline"} color={color} size={size} />
            ),
          })}
        />
        <Tab.Screen
          name="Offers"
          component={OffersScreen}
          options={() => ({
            title: t("offers.title", "Offerte"),
            headerTitle: t("offers.title", "Offerte"),
            tabBarLabel: t("offers.title", "Offerte"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "pricetags" : "pricetags-outline"} color={color} size={size} />
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
              <Ionicons name={focused ? "swap-horizontal" : "swap-horizontal-outline"} color={color} size={size} />
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
