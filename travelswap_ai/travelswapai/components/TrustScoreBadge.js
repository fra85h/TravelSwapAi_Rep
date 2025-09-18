import React from 'react';
import { View, Text } from 'react-native';

export default function TrustScoreBadge({ score }: { score?: number }) {
  if (typeof score !== 'number') return null;

  let label = 'Affidabilità';
  let bg = '#EEE';
  if (score >= 85) bg = '#C8F7C5';
  else if (score >= 70) bg = '#E7F7C5';
  else if (score >= 50) bg = '#FFF4C5';
  else bg = '#FFD6D6';

  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: bg }}>
      <Text style={{ fontWeight: '600' }}>{label}: {score}%</Text>
    </View>
  );
}
