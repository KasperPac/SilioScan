import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import BatchSelectScreen from '../screens/BatchSelectScreen';
import PickingScreen from '../screens/PickingScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type RootStackParamList = {
  BatchSelect: undefined;
  Picking: undefined;
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator(): React.JSX.Element {
  return (
    <Stack.Navigator
      initialRouteName="BatchSelect"
      screenOptions={{ headerShown: false }}
    >
      <Stack.Screen name="BatchSelect" component={BatchSelectScreen} />
      <Stack.Screen name="Picking" component={PickingScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
    </Stack.Navigator>
  );
}
