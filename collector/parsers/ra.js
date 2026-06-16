// collector/parsers/ra.js — TIER C (RA GraphQL). Auto-captures most serious LA collectives.
// Area 23 = Los Angeles. No key required; uses RA's public GraphQL endpoint.
const { httpPost, makeEvent, dateInTimeZone, formatTimeInTimeZone } = require('../util');

const ENDPOINT = 'https://ra.co/graphql';
const AREA_LA = 23;

const QUERY = `query GET_EVENT_LISTINGS($filters: FilterInputDtoInput, $pageSize: Int, $page: Int) {
  eventListings(filters: $filters, pageSize: $pageSize, page: $page) {
    data {
      id
      listingDate
      event {
        title
        date
        startTime
        endTime
        contentUrl
        flyerFront
        isTicketed
        venue { name area { name } }
        artists { name }
        genres { name }
        pick { blurb }
      }
    }
    totalResults
  }
}`;

async function collect({ maxPages = 6, pageSize = 50, sinceISO } = {}) {
  const events = [];
  const gte = (sinceISO || dateInTimeZone());
  for (let page = 1; page <= maxPages; page++) {
    let resp;
    try {
      resp = await httpPost(ENDPOINT, {
        query: QUERY,
        variables: { filters: { areas: { eq: AREA_LA }, listingDate: { gte } }, pageSize, page },
      }, { headers: { Referer: 'https://ra.co/events/us/losangeles', Origin: 'https://ra.co' } });
    } catch (e) {
      if (page === 1) throw e; // surface a total failure; partial is fine
      break;
    }
    const rows = resp?.data?.eventListings?.data || [];
    if (!rows.length) break;
    for (const row of rows) {
      const ev = row.event || {};
      const start = ev.startTime ? new Date(ev.startTime) : null;
      const end = ev.endTime ? new Date(ev.endTime) : null;
      events.push(makeEvent({
        title: ev.title,
        artists: (ev.artists || []).map((a) => a.name),
        date: (ev.date || row.listingDate || '').slice(0, 10) || null,
        start_time: formatTimeInTimeZone(start), end_time: formatTimeInTimeZone(end),
        venue: ev.venue?.name || '',
        region: 'Los Angeles',
        genres: (ev.genres || []).map((g) => g.name),
        description: ev.pick?.blurb || '',
        source_url: ev.contentUrl ? `https://ra.co${ev.contentUrl}` : 'https://ra.co/events/us/losangeles',
        ticket_url: ev.contentUrl ? `https://ra.co${ev.contentUrl}` : '',
        confidence: 'high',
      }, 'Resident Advisor'));
    }
    if (rows.length < pageSize) break;
  }
  return events;
}

module.exports = { collect, id: 'ra' };
