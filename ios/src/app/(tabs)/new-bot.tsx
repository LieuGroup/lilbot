/** Fallback route for the native `+` (`role="search"`) tab-bar trigger.
 *  Selection is prevented natively (`disabled`) and opens the New Bot modal sheet via `tabPress`;
 *  this route only guards against any programmatic navigation. */
import { Redirect } from 'expo-router'

export default function NewBotFallbackRoute() {
  return <Redirect href="/(tabs)/(bots)" />
}
