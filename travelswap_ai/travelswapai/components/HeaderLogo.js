import React from "react";
import { View, Text } from "react-native";
import { theme } from "../lib/theme";

export default function HeaderLogo() {
  return (
    <View style={{ flexDirection: "row", alignItems: "center" }}>
      <View
        style={{
          width: 18,
          height: 18,
          borderRadius: 4,
          borderWidth: 2,
          borderColor: theme.colors.boardingText,
          marginRight: 6,
          transform: [{ rotate: "-10deg" }],
        }}
      />
      <Text style={{ fontWeight: "800", fontSize: 16, color: theme.colors.boardingText }}>
        TravelSwapAi
      </Text>
    </View>
  );
}

