import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { theme } from "../lib/theme";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import HeaderLogo from "../components/HeaderLogo";

import HomeScreen from "./HomeScreen";
import AttivitaScreen from "./AttivitaScreen";
import ProfileScreen from "./ProfileScreen";
import { useI18n } from "../lib/i18n";
import { ActivityProvider, useActivity } from "../lib/ActivityContext";

const Tab = createBottomTabNavigator();
const TAB_BAR_HEIGHT = 70;

// Il tab centrale "Vendi" non apre una pagina propria: è una scorciatoia
// verso la creazione annuncio (l'azione che fa vivere il marketplace, oggi
// nascosta nel profilo). Lo schermo è fittizio, il tabPress è annullato.
function Noop() {
  return null;
}

function VendiButton() {
  const navigation = useNavigation();
  const { t } = useI18n();
  return (
    <TouchableOpacity
      style={styles.vendiWrap}
      activeOpacity={0.9}
      onPress={() => navigation.navigate("CreateListing")}
      accessibilityRole="button"
      accessibilityLabel={t("tabs.sell", "Vendi")}
    >
      <View style={styles.vendiDisc}>
        <Ionicons name="add" size={30} color={theme.colors.accentOn} />
      </View>
      <Text style={styles.vendiLabel}>{t("tabs.sell", "Vendi")}</Text>
    </TouchableOpacity>
  );
}

function MainTabsInner() {
  const { t } = useI18n();
  const { toDoCount, resolvedCount } = useActivity();
  // Numeretto rosso = cose da fare + esiti non ancora visti delle proprie
  // proposte (accettata/rifiutata): prima solo il "da fare" contava, chi
  // proponeva un'offerta non aveva alcun segnale quando riceveva risposta.
  const badgeCount = toDoCount + resolvedCount;

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Tab.Navigator
        screenOptions={{
          headerTitle: () => <HeaderLogo />,
          headerTitleAlign: "left",
          headerTintColor: theme.colors.boardingText,
          tabBarActiveTintColor: theme.colors.boardingText,
          tabBarInactiveTintColor: theme.colors.textMuted,
          tabBarStyle: { height: TAB_BAR_HEIGHT, paddingTop: 4, borderTopColor: theme.colors.border },
          tabBarLabelStyle: { paddingBottom: 6, fontWeight: "700" },
        }}
      >
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarLabel: t("tabs.explore", "Esplora"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "compass" : "compass-outline"} color={color} size={size} />
            ),
          }}
        />
        <Tab.Screen
          name="Vendi"
          component={Noop}
          options={{ tabBarButton: () => <VendiButton /> }}
          listeners={{ tabPress: (e) => e.preventDefault() }}
        />
        <Tab.Screen
          name="Attivita"
          component={AttivitaScreen}
          options={{
            tabBarLabel: t("tabs.activity", "Attività"),
            tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
            tabBarBadgeStyle: { backgroundColor: theme.colors.danger },
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name={focused ? "notifications" : "notifications-outline"} color={color} size={size} />
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

export default function MainTabs() {
  // Provider attorno ai tab: il conteggio "da fare" alimenta sia il
  // numeretto rosso sul tab Attività sia la schermata, dalla stessa fonte.
  return (
    <ActivityProvider>
      <MainTabsInner />
    </ActivityProvider>
  );
}

const styles = StyleSheet.create({
  vendiWrap: {
    flex: 1,
    alignItems: "center",
    justifyContent: "flex-start",
    paddingTop: 4,
  },
  vendiDisc: {
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: theme.colors.accent, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
    }),
  },
  vendiLabel: {
    marginTop: 3,
    fontSize: 11,
    fontWeight: "800",
    color: theme.colors.boardingText,
  },
});
