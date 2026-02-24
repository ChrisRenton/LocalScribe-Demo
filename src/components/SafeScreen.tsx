import React from 'react';
import {View, StatusBar, Platform, StyleSheet, ViewStyle} from 'react-native';

interface SafeScreenProps {
  children: React.ReactNode;
  style?: ViewStyle;
}

/**
 * A safe area wrapper that properly handles Android status bar
 * and navigation bar insets. Use this instead of SafeAreaView.
 */
export default function SafeScreen({children, style}: SafeScreenProps) {
  const topInset = Platform.OS === 'android' ? (StatusBar.currentHeight || 24) : 0;
  // Android 3-button nav bar is typically ~48dp; gesture nav is ~20dp.
  // We use 48 to safely clear the 3-button navigation bar.
  const bottomInset = Platform.OS === 'android' ? 48 : 0;

  return (
    <View
      style={[
        styles.container,
        {paddingTop: topInset, paddingBottom: bottomInset},
        style,
      ]}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" translucent />
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
});
