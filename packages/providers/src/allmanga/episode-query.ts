/**
 * Desktop episode document from mkissa `Bj(true, true, false)` in
 * `chunks/DmW2_MRj.js` (build 189, extracted 2026-11-12).
 *
 * sha256 is `ALLMANGA_QUERY_HASH`. GET still sends only the hash. When that
 * automatic persisted query misses, the client POSTs this exact text once.
 * A one-byte drift hashes differently and the API rejects it the same way.
 * Do not retype this document.
 */
export const ALLMANGA_EPISODE_QUERY = `
query(
$showId: String!
$translationType: VaildTranslationTypeEnumType!
$episodeString: String!
) {
episode(
showId: $showId
translationType: $translationType
episodeString: $episodeString
) {
episodeString
uploadDate
sourceUrls
thumbnail
notes
show{


_id
name
englishName
nativeName
slugTime

thumbnail

tbObj {
  u
  sm
  md
  ts
}

lastEpisodeInfo
lastEpisodeDate
type
season
score
airedStart
availableEpisodes
episodeDuration
episodeCount
# lastUpdateStart
lastUpdateEnd
characterCount
playlistCount
tierListCount
worldMapCount
caseFileCount
isAdult
adultAssetsHidden

siteRanks {
  entries {
    key
    label
    position
    delta
    sortOrder
    score
    windowDays
  }
  weekly { score windowDays }
  monthly { score windowDays }
  overall { score windowDays }
  bookmarked { score windowDays }
  bookmarkedOverall { score windowDays }
  boostedMonthly { score windowDays }
  boosted { score windowDays }
}


description
broadcastInterval
banner
characters
availableEpisodesDetail
nameOnlyString
characters
isAdult
relatedShows
relatedMangas
altNames
disqusIds
}
pageStatus{
_id
notes
pageId
showId

# ranks:[Object]
views
likesCount
commentCount
dislikesCount
boostsCount
reviewCount
userScoreCount
userScoreTotalValue
userScoreAverValue
viewers{
firstViewers{
viewCount
lastWatchedDate
user{

  
  
  _id
  username
  displayName
  createdAt
  picture
  reputation
  roleLevel

  
  brief
  followerCount
  followingCount
  pDec
  equippedBadgeKey
  equippedBadge {
    
  key
  name
  rank
  iconPath
  date
  
  badgeUi {
    markKind
    tone
    shine
    shineRate
  }


  }
  personaTags
  
  ugcContributorStats {
    mediaEditReviewSubmitCount
    mediaEditApprovedCount
    mediaEditRejectedCount
    mediaEditAppliedCount
    mediaEditContributionPoints
    mediaEditModContributionPoints
  }


  hideMe

}
}
recViewers{
viewCount
lastWatchedDate
user{

  
  
  _id
  username
  displayName
  createdAt
  picture
  reputation
  roleLevel

  
  brief
  followerCount
  followingCount
  pDec
  equippedBadgeKey
  equippedBadge {
    
  key
  name
  rank
  iconPath
  date
  
  badgeUi {
    markKind
    tone
    shine
    shineRate
  }


  }
  personaTags
  
  ugcContributorStats {
    mediaEditReviewSubmitCount
    mediaEditApprovedCount
    mediaEditRejectedCount
    mediaEditAppliedCount
    mediaEditContributionPoints
    mediaEditModContributionPoints
  }


  hideMe

}
}
}

}
episodeInfo{
notes
thumbnails

tbObj {
  u
  sm
  md
  ts
}

vidInforssub
uploadDates
vidInforsdub
vidInforsraw
description
}
versionFix
}
}
`;
