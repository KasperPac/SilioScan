// ============================================================
// AppNavigator.tsx — Native stack navigator
// Routes:
//   Picking  — primary operator workflow (initial route)
//   Settings — PLC connection + scanner config
// ============================================================

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import PickingScreen from '../screens/PickingScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type RootStackParamList = {
  Picking: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      initialRouteName="Picking"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="Picking" component={PickingScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
