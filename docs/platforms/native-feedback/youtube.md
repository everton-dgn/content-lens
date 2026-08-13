# Addendum de feedback nativo do YouTube

| Campo | Contrato atual |
| --- | --- |
| Adapter | `youtube-adapter@1` |
| Addendum | `youtube-native-feedback@1` |
| Fixture | `youtube-fixtures@1` |
| Ações permitidas | `youtube:not-interested`, `youtube:do-not-recommend-channel` |
| Superfícies declaradas | home, search, recommendations, subscriptions, shorts, channel, playlist, end-screen |
| Identidade | video ID estável; channel ID adicional para a segunda ação |
| Evidência positiva | confirmação visível ligada ao mesmo vídeo ou canal |
| Timeout | 2 segundos |
| Cooldown mínimo | 24 horas |
| Undo | não comprovado, declarar irreversível |
| Live smoke | ausente |
| Estado | `unsupported` em todas as superfícies |

Antes da promoção, uma conta e vídeos controlados devem comprovar menu público,
rótulos por locale, identidade antes e depois da abertura do menu, confirmação
positiva e ausência de navegação. Subscribe, unsubscribe, like, dislike, report
e block são proibidos.
