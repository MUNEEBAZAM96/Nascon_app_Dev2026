import { Redirect } from 'expo-router';

import { useSession } from '../src/auth/session';

export default function Index() {
  const { token } = useSession();
  return <Redirect href={token ? '/fixtures' : '/login'} />;
}
