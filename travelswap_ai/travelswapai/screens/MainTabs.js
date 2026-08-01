import React from "react";
import { View, Text, TouchableOpacity, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { theme } from "../lib/theme";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import HeaderLogo from "../components/HeaderLogo";
import ChainPulseIcon from "../components/ChainPulseIcon";

import HomeScreen from "./HomeScreen";
import AttivitaScreen from "./AttivitaScreen";
import ProfileScreen from "./ProfileScreen";
import { useI18n } from "../lib/i18n";
import { ActivityProvider, useActivity } from "../lib/ActivityContext";

const Tab = createBottomTabNavigator();

// Barra "a pillola" staccata dal bordo, sullo stile delle app recenti
// (Instagram, Spotify): la barra non è più un fondo pieno attaccato allo
// schermo ma un elemento che galleggia sopra il contenuto.
//
// Le etichette restano. È la differenza che conta rispetto a Instagram, che
// usa solo icone: là le quattro destinazioni le conosce chiunque, qui
// "Attività" non si indovina da una campanella, e su un'app che nessuno ha
// mai usato togliere le parole costa più di quanto renda. Restano solo più
// piccole e più strette.
const TAB_BAR_HEIGHT = 64;
// Quanto la pillola sta staccata dal bordo inferiore (oltre alla safe area).
const TAB_BAR_LIFT = 12;
const TAB_BAR_SIDE_MARGIN = 14;

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
      // push, non navigate: CreateListingScreen resta montato nello stack
      // anche dopo aver cambiato tab (è un fratello di MainTabs, non un suo
      // figlio). navigate() riuserebbe quell'istanza già esistente — fase
      // ("intro"/"manual") e form ancora quelli della sessione precedente —
      // quindi il box "Importa il biglietto" spariva dopo la prima visita.
      // push forza sempre un'istanza nuova, con lo stato resettato.
      onPress={() => navigation.push("CreateListing")}
      accessibilityRole="button"
      accessibilityLabel={t("tabs.sell", "Vendi")}
    >
      {/* Il disco vive dentro una fessura alta quanto le icone degli altri
          tab e ne trabocca simmetricamente (sopra e sotto). È l'unico modo
          per tenere l'etichetta "Vendi" sulla stessa riga di "Esplora",
          "Attività" e "Profilo": misurando il disco intero, il testo veniva
          spinto più in basso delle altre tre e l'allineamento si rompeva. */}
      <View style={styles.vendiSlot}>
        <View style={styles.vendiDisc}>
          <Ionicons name="add" size={22} color={theme.colors.accentOn} />
        </View>
      </View>
      <Text style={styles.vendiLabel}>{t("tabs.sell", "Vendi")}</Text>
    </TouchableOpacity>
  );
}

function MainTabsInner() {
  const { t } = useI18n();
  const insets = useSafeAreaInsets();
  // Con la barra flottante (position: absolute) il contenuto le passa SOTTO:
  // senza questo spazio in fondo, l'ultimo annuncio di ogni lista finirebbe
  // coperto dalla pillola. sceneStyle lo applica a tutte le schermate dei
  // tab in un colpo solo, invece di doverlo ripetere in ognuna.
  const bottomClearance = TAB_BAR_HEIGHT + TAB_BAR_LIFT + insets.bottom;
  const { summary, toDoCount, resolvedCount, unreadChatCount } = useActivity();
  // Numeretto rosso = cose da fare + esiti non ancora visti delle proprie
  // proposte (accettata/rifiutata) + messaggi chat non letti: tutto ciò che
  // aspetta l'utente vive in Attività, il tab deve rifletterlo.
  const badgeCount = toDoCount + resolvedCount + unreadChatCount;
  // Uno swap a 3 in attesa di TUA conferma è l'evento più raro dei due (serve
  // l'incastro di 3 persone): quando c'è, prende lui l'icona del tab al posto
  // della campanella — il numeretto resta cumulativo, cambia solo l'icona.
  const hasChainToDo = (summary?.toDo || []).some((it) => it.kind === "chain");

  return (
    <View style={{ flex: 1, backgroundColor: theme.colors.background }}>
      <Tab.Navigator
        screenOptions={{
          headerTitle: () => <HeaderLogo />,
          headerTitleAlign: "left",
          headerTintColor: theme.colors.boardingText,
          tabBarActiveTintColor: theme.colors.boardingText,
          tabBarInactiveTintColor: theme.colors.textMuted,
          sceneStyle: { paddingBottom: bottomClearance },
          tabBarStyle: {
            position: "absolute",
            left: TAB_BAR_SIDE_MARGIN,
            right: TAB_BAR_SIDE_MARGIN,
            bottom: insets.bottom + TAB_BAR_LIFT,
            height: TAB_BAR_HEIGHT,
            paddingTop: 6,
            paddingBottom: 0,
            borderRadius: TAB_BAR_HEIGHT / 2,
            backgroundColor: theme.colors.surface,
            // La pillola galleggia: niente linea di separazione in cima (non
            // c'è più niente da separare) e ombra al posto del bordo.
            borderTopWidth: 0,
            elevation: 12,
            shadowColor: "#0F172A",
            shadowOpacity: 0.14,
            shadowRadius: 20,
            shadowOffset: { width: 0, height: 8 },
          },
          tabBarItemStyle: { paddingVertical: 0 },
          tabBarLabelStyle: { fontSize: 10, fontWeight: "700", marginTop: -2 },
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
            // Etichetta e badge seguono l'icona nello stesso oro dell'accento
            // quando c'è una catena in attesa: è uno stato a parte, non il
            // solito focused/unfocused, quindi non usa i tint standard del
            // Navigator (boardingText/textMuted).
            tabBarLabel: ({ color, focused }) => (
              <Text style={{
                fontSize: 10, fontWeight: "700", marginTop: -2,
                color: hasChainToDo ? theme.colors.accent : color,
              }}>
                {t("tabs.activity", "Attività")}
              </Text>
            ),
            tabBarBadge: badgeCount > 0 ? badgeCount : undefined,
            tabBarBadgeStyle: { backgroundColor: hasChainToDo ? theme.colors.accent : theme.colors.danger },
            tabBarIcon: ({ color, size, focused }) =>
              hasChainToDo ? (
                <ChainPulseIcon color={theme.colors.accent} size={size} focused={focused} />
              ) : (
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
  },
  // Stessa altezza dell'icona degli altri tab: è questa a dettare dove cade
  // l'etichetta, non la dimensione del disco.
  vendiSlot: {
    height: 24,
    alignItems: "center",
    justifyContent: "center",
  },
  vendiDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: theme.colors.accent, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
    }),
  },
  vendiLabel: {
    // Stesso scarto di tabBarLabelStyle, così le quattro etichette sono
    // esattamente sulla stessa riga.
    marginTop: -2,
    fontSize: 10,
    fontWeight: "800",
    color: theme.colors.boardingText,
  },
});
