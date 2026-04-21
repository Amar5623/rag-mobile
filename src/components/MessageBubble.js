import React from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import Markdown from 'react-native-markdown-display';
import { OfflineChunkCard } from './OfflineChunkCard';
import { colors, spacing, radius, typography } from '../config/theme';

const markdownStyles = {
  body:      { color: colors.text1, fontSize: typography.fontSize.md, lineHeight: 22 },
  code_block:{ backgroundColor: colors.bg3, padding: spacing.sm, borderRadius: radius.sm },
  code_inline:{ backgroundColor: colors.bg3, color: colors.teal, fontFamily: 'Courier New' },
  heading1:  { color: colors.text0, fontSize: typography.fontSize.xl },
  heading2:  { color: colors.text0, fontSize: typography.fontSize.lg },
  strong:    { color: colors.text0 },
};

export function MessageBubble({ message }) {
  const isUser = message.role === 'user';

  if (isUser) {
    return (
      <View style={styles.userRow}>
        <View style={styles.userBubble}>
          <Text style={styles.userText}>{message.content}</Text>
        </View>
      </View>
    );
  }

  // Offline: show chunk cards
  if (message.is_offline) {
    return (
      <View style={styles.assistantRow}>
        <View style={styles.offlineHeader}>
          <Text style={styles.offlineLabel}>◈ Retrieved sections</Text>
        </View>
        {(message.offline_chunks || []).map((chunk, i) => (
          <OfflineChunkCard key={chunk.id || i} chunk={chunk} />
        ))}
        {message.offline_chunks?.length === 0 && !message.isError && (
          <Text style={styles.emptyText}>No matching sections found.</Text>
        )}
        {message.isError && (
          <Text style={styles.errorText}>{message.content}</Text>
        )}
      </View>
    );
  }

  // Online: streaming markdown
  return (
    <View style={styles.assistantRow}>
      <View style={styles.assistantBubble}>
        {message.content ? (
          <Markdown style={markdownStyles}>{message.content}</Markdown>
        ) : (
          <ActivityIndicator size="small" color={colors.accent} />
        )}
        {message.streaming && message.content ? (
          <Text style={styles.cursor}>▊</Text>
        ) : null}
      </View>

      {/* Citations */}
      {(message.citations || []).length > 0 && (
        <View style={styles.citations}>
          {message.citations.map((c, i) => (
            <View key={i} style={styles.citationChip}>
              <Text style={styles.citationText} numberOfLines={1}>
                {c.source}{c.page ? ` p${c.page}` : ''}
              </Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  userRow:        { alignItems: 'flex-end', marginVertical: spacing.xs },
  userBubble:     { backgroundColor: colors.accent, borderRadius: radius.lg,
                    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                    maxWidth: '80%' },
  userText:       { color: '#fff', fontSize: typography.fontSize.md },
  assistantRow:   { alignItems: 'flex-start', marginVertical: spacing.xs },
  assistantBubble:{ backgroundColor: colors.bg2, borderRadius: radius.lg,
                    borderWidth: 1, borderColor: colors.border,
                    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
                    maxWidth: '92%' },
  cursor:         { color: colors.accent, fontSize: 14 },
  offlineHeader:  { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.xs },
  offlineLabel:   { color: colors.text2, fontSize: typography.fontSize.sm,
                    fontFamily: 'Courier New' },
  emptyText:      { color: colors.text3, fontSize: typography.fontSize.sm, padding: spacing.sm },
  errorText:      { color: colors.error, fontSize: typography.fontSize.sm, padding: spacing.sm },
  citations:      { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs,
                    marginTop: spacing.xs, maxWidth: '92%' },
  citationChip:   { backgroundColor: colors.bg3, borderRadius: radius.full,
                    borderWidth: 1, borderColor: colors.border,
                    paddingHorizontal: spacing.sm, paddingVertical: 2 },
  citationText:   { color: colors.accentText, fontSize: typography.fontSize.xs,
                    fontFamily: 'Courier New' },
});