// components/OfferCTAs.js
import { View, TouchableOpacity, Text, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useTranslation } from "../lib/i18n";
//import { theme } from "../lib";
import { theme } from "../lib/theme";

export default function OfferCTAs({ listing, me }) {
  const navigation = useNavigation();
  const { t } = useTranslation();

  const isMine = me?.id && listing?.user_id === me.id;
  const status = listing?.status ?? "active";
  const owner = listing?.user_id ?? null; 
  const enabled = status === "active" && (!owner || owner !== me?.id);

  if (!enabled) return null;

  return (
    <View style={s.row}>
      <TouchableOpacity
        style={[s.btn, s.buy]}
        onPress={() =>
          navigation.navigate("OfferFlow", { mode: "BUY", listingId: listing.id })
        }
      >
        <Text style={s.btnTxt}>
          {t("offers.proposePurchase", "Proponi acquisto")}
        </Text>
      </TouchableOpacity>
      <TouchableOpacity
        style={[s.btn, s.swap]}
        onPress={() =>
          navigation.navigate("OfferFlow", { mode: "SWAP", listingId: listing.id })
        }
      >
        <Text style={s.btnTxt}>
          {t("offers.proposeSwap", "Proponi scambio")}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", gap: 10, marginTop: 10 },
  btn: { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: "center" },
  buy: { backgroundColor: theme.colors.primary },
  swap: { backgroundColor: theme.colors.primary },
  btnTxt: { color: theme.colors.boardingText, fontWeight: "800" },
});
