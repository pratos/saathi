import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import * as SecureStore from 'expo-secure-store'

const SPACE_KEY = 'saath.selectedSpaceId'

export const authStorage = {
  getItem: (key: string) => Platform.OS === 'android'
    ? AsyncStorage.getItem(key)
    : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => Platform.OS === 'android'
    ? AsyncStorage.setItem(key, value)
    : SecureStore.setItemAsync(key, value),
  removeItem: (key: string) => Platform.OS === 'android'
    ? AsyncStorage.removeItem(key)
    : SecureStore.deleteItemAsync(key),
}

export async function readSelectedSpaceId() {
  return AsyncStorage.getItem(SPACE_KEY)
}

export async function writeSelectedSpaceId(spaceId: string) {
  await AsyncStorage.setItem(SPACE_KEY, spaceId)
}
