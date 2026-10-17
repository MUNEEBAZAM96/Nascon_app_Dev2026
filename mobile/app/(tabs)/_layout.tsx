import { router, usePathname } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import PagerView from 'react-native-pager-view';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useSession } from '../../src/auth/session';
import { CoolTabBar } from '../../src/components/CoolTabBar';
import FixturesScreen from '../../src/screens/FixturesScreen';
import ProfileScreen from '../../src/screens/ProfileScreen';
import StandingsScreen from '../../src/screens/StandingsScreen';
import StoreScreen from '../../src/screens/StoreScreen';
import { tenantTheme } from '../../src/theme/tenant';

const TABS = [
  { href: '/fixtures', title: 'Fixtures' },
  { href: '/standings', title: 'Standings' },
  { href: '/store', title: 'Store' },
  { href: '/profile', title: 'Profile' },
] as const;

function indexFromPath(path: string): number {
  if (path === '/' || path.startsWith('/fixtures')) return 0;
  if (path.startsWith('/standings')) return 1;
  if (path.startsWith('/store')) return 2;
  if (path.startsWith('/profile')) return 3;
  return -1;
}

export default function TabsLayout() {
  const pathname = usePathname();
  const { claims } = useSession();
  const theme = tenantTheme(claims?.tenant_id);
  const insets = useSafeAreaInsets();
  const pagerRef = useRef<PagerView>(null);
  const swipeLock = useRef(false);
  const [index, setIndex] = useState(() => Math.max(0, indexFromPath(pathname)));

  useEffect(() => {
    const next = indexFromPath(pathname);
    if (next < 0) return;
    if (swipeLock.current) {
      swipeLock.current = false;
      return;
    }
    if (next === index) return;
    setIndex(next);
    pagerRef.current?.setPage(next);
  }, [pathname, index]);

  function select(next: number) {
    setIndex(next);
    pagerRef.current?.setPage(next);
  }

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top, backgroundColor: theme.primary }]}>
        <Text style={styles.kicker}>{theme.name}</Text>
        <Text style={styles.title} accessibilityRole="header">{TABS[index].title}</Text>
      </View>
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={index}
        overScrollMode="never"
        offscreenPageLimit={1}
        onPageSelected={(event) => {
          const next = event.nativeEvent.position;
          setIndex(next);
          swipeLock.current = true;
          router.navigate(TABS[next].href);
        }}
      >
        <View key="fixtures" style={[styles.page, { paddingBottom: 64 + insets.bottom + 16 }]}>
          <FixturesScreen active={index === 0} />
        </View>
        <View key="standings" style={[styles.page, { paddingBottom: 64 + insets.bottom + 16 }]}>
          <StandingsScreen active={index === 1} />
        </View>
        <View key="store" style={[styles.page, { paddingBottom: 64 + insets.bottom + 16 }]}>
          <StoreScreen active={index === 2} />
        </View>
        <View key="profile" style={[styles.page, { paddingBottom: 64 + insets.bottom + 16 }]}>
          <ProfileScreen />
        </View>
      </PagerView>
      <CoolTabBar index={index} onPress={select} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F3F6F4' },
  header: { alignItems: 'flex-start', justifyContent: 'flex-end', paddingHorizontal: 16, paddingBottom: 12, minHeight: 64 },
  kicker: { color: '#E8F5E9', fontSize: 13, fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: '#FFFFFF' },
  pager: { flex: 1 },
  page: { flex: 1 },
});
