import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Stack } from "expo-router";
import * as SplashScreen from "expo-splash-screen";
import { StatusBar } from "expo-status-bar";
import React, { useEffect } from "react";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { TradeHistoryProvider } from "@/contexts/TradeHistoryContext";
import { TickerScanProvider } from "@/contexts/TickerScanContext";

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav() {
  return (
    <Stack screenOptions={{ headerShown: false }}>
      <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
      <Stack.Screen name="ticker/[symbol]" options={{ headerShown: false, presentation: 'card' }} />
      <Stack.Screen name="+not-found" />
    </Stack>
  );
}

export default function RootLayout() {
  useEffect(() => {
    SplashScreen.hideAsync();
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TickerScanProvider>
        <TradeHistoryProvider>
          <GestureHandlerRootView style={{ flex: 1, backgroundColor: '#0a0a1a' }}>
            <StatusBar style="light" backgroundColor="#0a0a1a" />
            <RootLayoutNav />
          </GestureHandlerRootView>
        </TradeHistoryProvider>
      </TickerScanProvider>
    </QueryClientProvider>
  );
}
