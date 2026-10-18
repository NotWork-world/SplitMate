import React, {useCallback, useEffect, useState} from 'react';
import {StyleSheet} from 'react-native';
import {GestureHandlerRootView} from 'react-native-gesture-handler';
import {SafeAreaProvider} from 'react-native-safe-area-context';
import {Provider} from 'react-redux';
import {loadApiUrl} from './src/config';
import {ThemeProvider, ToastProvider} from './src/design';
import {Splash} from './src/features/auth/Splash';
import {restoreSession} from './src/features/auth/session';
import {draftActions, loadDrafts} from './src/features/expenses/draft';
import {RootNavigator} from './src/navigation/RootNavigator';
import {store, useAppSelector} from './src/store';
import {ThemePreferenceProvider} from './src/themePreference';

function Shell() {
  const status = useAppSelector(s => s.auth.status);
  const [splashDone, setSplashDone] = useState(false);
  const onDone = useCallback(() => setSplashDone(true), []);
  return (
    <>
      <RootNavigator />
      {!splashDone ? <Splash ready={status !== 'restoring'} onDone={onDone} /> : null}
    </>
  );
}

export default function App() {
  useEffect(() => {
    (async () => {
      await loadApiUrl();
      store.dispatch(draftActions.loaded(await loadDrafts()));
      await restoreSession(store.dispatch);
    })();
  }, []);

  return (
    <GestureHandlerRootView style={styles.root}>
      <Provider store={store}>
        <SafeAreaProvider>
          <ThemePreferenceProvider>
            {preference => (
              <ThemeProvider preference={preference}>
                <ToastProvider>
                  <Shell />
                </ToastProvider>
              </ThemeProvider>
            )}
          </ThemePreferenceProvider>
        </SafeAreaProvider>
      </Provider>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({root: {flex: 1}});
