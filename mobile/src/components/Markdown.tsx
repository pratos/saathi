import { Linking, StyleSheet, Text, View } from 'react-native'
import { colors, fonts, type } from '../theme'

export function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/)
  return (
    <View style={{ gap: 10 }}>
      {blocks.map((block, index) => (
        <Text key={`${index}-${block.slice(0, 12)}`} style={styles.body}>
          {renderInline(block.trim())}
        </Text>
      ))}
    </View>
  )
}

function renderInline(value: string) {
  const parts = value.split(/(\*\*[^*]+\*\*|`[^`]+`|https?:\/\/[^\s)]+)/g)
  return parts.map((part, index) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <Text key={index} style={styles.bold}>{part.slice(2, -2)}</Text>
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <Text key={index} style={styles.code}>{part.slice(1, -1)}</Text>
    }
    if (part.startsWith('https://')) {
      return (
        <Text key={index} style={styles.link} onPress={() => void Linking.openURL(part)}>
          {part}
        </Text>
      )
    }
    return <Text key={index}>{part}</Text>
  })
}

const styles = StyleSheet.create({
  body: {
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: type.body,
    lineHeight: 24,
  },
  bold: {
    fontFamily: fonts.sansBold,
  },
  code: {
    fontFamily: fonts.sansMedium,
    color: colors.amber,
  },
  link: {
    color: colors.teal,
    textDecorationLine: 'underline',
  },
})
