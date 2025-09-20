import React from "react";
import { View, Text, Image } from "react-native";
import { theme } from "../lib/theme";

export default function HeaderLogo() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <Image
        source={require("../assets/logoheader.png")}
        style={{
          width: 40,
          height: 40,
          resizeMode: "contain",
          marginRight: 8,
        }}
      />
      <Text
        style={{
          fontWeight: "800",
          fontSize: 16,
          color: theme.colors.boardingText,
        }}
      >
        TravelSwapAI
      </Text>
    </View>
  );
}
