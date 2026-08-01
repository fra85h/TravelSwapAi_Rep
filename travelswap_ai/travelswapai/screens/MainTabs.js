import React from "react";
import { View, Text, StyleSheet, Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { theme } from "../lib/theme";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
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
const TAB_BAR_HEIGHT = theme.tabBar.height;
// Quanto la pillola sta staccata dal bordo inferiore (oltre alla safe area).
const TAB_BAR_LIFT = theme.tabBar.lift;
const TAB_BAR_SIDE_MARGIN = theme.tabBar.sideMargin;
// Altezza della sfumatura che precede la barra: il contenuto ci svanisce
// dentro invece di essere tranciato di netto dal bordo della lista.
const TAB_BAR_FADE_HEIGHT = theme.tabBar.fadeHeight;

// Il tab centrale "Vendi" non apre una pagina propria: è una scorciatoia
// verso la creazione annuncio (l'azione che fa vivere il marketplace, oggi
// nascosta nel profilo). Lo schermo è fittizio, il tabPress è annullato.
function Noop() {
  return null;
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
          // Icone SEMPRE a contorno, anche sul tab attivo: a distinguerlo è
          // il colore, non il riempimento. Prima l'attivo passava alla
          // variante piena e nella pillola il risultato si leggeva come
          // "due icone di un tipo e due di un altro" invece che come "una
          // selezionata e tre no" — l'incoerenza saltava all'occhio più della
          // selezione, che è l'informazione che il riempimento doveva dare.
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
            elevation: 16,
            shadowColor: "#0F172A",
            // Ombra più profonda della shadow.md del tema: qui è l'unica cosa
            // che stacca la pillola dal contenuto, non essendoci più né bordo
            // né fondo pieno. Sul web le ombre RN rendono più tenui che sul
            // telefono, ed era appena percettibile.
            shadowOpacity: 0.22,
            shadowRadius: 24,
            shadowOffset: { width: 0, height: 10 },
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
              <Ionicons name="compass-outline" color={color} size={size} />
            ),
          }}
        />
        {/* "Vendi" NON usa più tabBarButton. Sostituendo l'intera cella si
            sostituiva anche il modo in cui React Navigation dispone icona ed
            etichetta, e per quanto si aggiustassero i margini l'etichetta non
            cadeva mai sulla stessa riga delle altre tre: due sistemi di
            layout diversi messi a confronto a occhio. Ora è un tab come gli
            altri — icona + etichetta — e il disco oro è semplicemente
            un'icona che ha la forma di un cerchio. L'allineamento non è più
            una cosa da azzeccare: è lo stesso codice che dispone tutti e
            quattro. Il tocco resta dirottato sulla creazione annuncio. */}
        <Tab.Screen
          name="Vendi"
          component={Noop}
          options={{
            // Nessuna etichetta, come il pulsante centrale di Instagram o
            // TikTok: il "+" oro si spiega da sé, e senza testo sotto il
            // disco ha tutto lo spazio della cella per essere grande davvero.
            // È anche ciò che mette al riparo dal problema che si è ripetuto
            // tre volte: non avendo un'etichetta, non può più trascinarla
            // fuori riga rispetto alle altre tre.
            tabBarLabel: () => null,
            tabBarIcon: () => (
              <View style={styles.vendiDisc}>
                <Ionicons name="add" size={26} color={theme.colors.accentOn} />
              </View>
            ),
          }}
          listeners={({ navigation }) => ({
            tabPress: (e) => {
              e.preventDefault();
              // push e non navigate: CreateListingScreen resta montato nello
              // stack anche cambiando tab (è fratello di MainTabs, non figlio).
              // navigate riuserebbe quell'istanza — fase e form ancora quelli
              // della sessione precedente — e il box "Importa il biglietto"
              // spariva dopo la prima visita. push forza un'istanza nuova.
              navigation.getParent()?.push("CreateListing");
            },
          })}
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
                <Ionicons name="notifications-outline" color={color} size={size} />
              ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={ProfileScreen}
          options={{
            tabBarLabel: t("profile.title", "Profilo"),
            tabBarIcon: ({ color, size, focused }) => (
              <Ionicons name="person-outline" color={color} size={size} />
            ),
          }}
        />
      </Tab.Navigator>

      {/* Sfumatura sopra la pillola. Il contenuto delle liste finisce esatto
          sul bordo superiore della barra (è lì che si ferma la loro area
          visibile) e veniva tagliato di netto a metà card: qui sfuma nel
          colore di sfondo, così sembra svanire invece che essere reciso.
          pointerEvents="none": è decorazione, non deve rubare un solo tocco
          alla lista che ci scorre sotto. Sta DOPO il Navigator — quindi
          disegnata sopra le schermate — ma si ferma dove comincia la
          pillola, che resta pienamente visibile. */}
      <LinearGradient
        pointerEvents="none"
        colors={["rgba(249,248,252,0)", theme.colors.background]}
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: insets.bottom + TAB_BAR_LIFT + TAB_BAR_HEIGHT,
          height: TAB_BAR_FADE_HEIGHT,
        }}
      />
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
  vendiDisc: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: theme.colors.accent,
    alignItems: "center",
    justifyContent: "center",
    ...Platform.select({
      ios: { shadowColor: theme.colors.accent, shadowOpacity: 0.5, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } },
      android: { elevation: 6 },
    }),
  },
});
