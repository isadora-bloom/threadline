'use client'

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
} from '@react-pdf/renderer'

const styles = StyleSheet.create({
  page: {
    fontFamily: 'Helvetica',
    fontSize: 10,
    padding: 50,
    color: '#1e293b',
    backgroundColor: '#ffffff',
  },
  coverPage: {
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'center',
    height: '100%',
  },
  coverTitle: {
    fontSize: 24,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    marginBottom: 8,
  },
  coverSubtitle: {
    fontSize: 14,
    color: '#475569',
    marginBottom: 40,
  },
  coverMeta: {
    backgroundColor: '#f8fafc',
    padding: 16,
    borderRadius: 4,
    borderLeft: '3 solid #4f46e5',
  },
  coverMetaRow: {
    flexDirection: 'row',
    marginBottom: 6,
  },
  coverMetaLabel: {
    fontSize: 9,
    fontFamily: 'Helvetica-Bold',
    color: '#64748b',
    width: 120,
    textTransform: 'uppercase',
  },
  coverMetaValue: {
    fontSize: 10,
    color: '#1e293b',
    flex: 1,
  },
  sectionTitle: {
    fontSize: 13,
    fontFamily: 'Helvetica-Bold',
    color: '#0f172a',
    marginBottom: 8,
    marginTop: 20,
    paddingBottom: 4,
    borderBottom: '1 solid #e2e8f0',
  },
  bodyText: {
    fontSize: 10,
    lineHeight: 1.6,
    color: '#334155',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#0f172a',
    padding: '6 8',
    marginBottom: 0,
  },
  tableRow: {
    flexDirection: 'row',
    padding: '5 8',
    borderBottom: '1 solid #e2e8f0',
  },
  tableRowAlt: {
    flexDirection: 'row',
    padding: '5 8',
    backgroundColor: '#f8fafc',
    borderBottom: '1 solid #e2e8f0',
  },
  tableHeaderCell: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    color: '#ffffff',
    textTransform: 'uppercase',
  },
  tableCell: {
    fontSize: 9,
    color: '#334155',
  },
  badge: {
    fontSize: 8,
    fontFamily: 'Helvetica-Bold',
    paddingHorizontal: 4,
    paddingVertical: 2,
    borderRadius: 2,
  },
  warningBox: {
    backgroundColor: '#fefce8',
    padding: 12,
    borderRadius: 4,
    borderLeft: '3 solid #eab308',
    marginVertical: 8,
  },
  warningText: {
    fontSize: 9,
    color: '#713f12',
  },
  footer: {
    position: 'absolute',
    bottom: 30,
    left: 50,
    right: 50,
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderTop: '1 solid #e2e8f0',
    paddingTop: 8,
  },
  footerText: {
    fontSize: 8,
    color: '#94a3b8',
  },
})

interface PDFClaim {
  id: string
  extracted_text: string
  claim_type: string
  verification_status: string
  source_confidence: string
  content_confidence: string
  interpretation_flag: boolean
}

interface PDFEntity {
  id: string
  entity_type: string
  raw_value: string
  normalized_value?: string | null
}

interface HandoffPDFProps {
  caseTitle: string
  preparedBy: string
  recipientName: string
  recipientType: string
  purpose: string
  caseSummary: string
  methodologyNote: string
  confidenceStatement: string
  claims: PDFClaim[]
  entities: PDFEntity[]
  exportDate: string
}

export function HandoffPDF({
  caseTitle,
  preparedBy,
  recipientName,
  recipientType,
  purpose,
  caseSummary,
  methodologyNote,
  confidenceStatement,
  claims,
  entities,
  exportDate,
}: HandoffPDFProps) {
  const dateStr = new Date(exportDate).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  })

  return (
    <Document title={`Threadline Case Package — ${caseTitle}`}>
      {/* Cover page */}
      <Page size="LETTER" style={styles.page}>
        <View style={styles.coverPage}>
          <Text style={{ fontSize: 11, color: '#6366f1', fontFamily: 'Helvetica-Bold', marginBottom: 16, textTransform: 'uppercase', letterSpacing: 2 }}>
            THREADLINE — CASE INTELLIGENCE
          </Text>
          <Text style={styles.coverTitle}>{caseTitle}</Text>
          <Text style={styles.coverSubtitle}>Investigative Handoff Package</Text>

          <View style={styles.coverMeta}>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Date prepared</Text>
              <Text style={styles.coverMetaValue}>{dateStr}</Text>
            </View>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Prepared by</Text>
              <Text style={styles.coverMetaValue}>{preparedBy}</Text>
            </View>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Recipient</Text>
              <Text style={styles.coverMetaValue}>{recipientName}</Text>
            </View>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Recipient type</Text>
              <Text style={styles.coverMetaValue}>{recipientType.replace('_', ' ').toUpperCase()}</Text>
            </View>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Purpose</Text>
              <Text style={styles.coverMetaValue}>{purpose}</Text>
            </View>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Claims included</Text>
              <Text style={styles.coverMetaValue}>{claims.length}</Text>
            </View>
            <View style={styles.coverMetaRow}>
              <Text style={styles.coverMetaLabel}>Entities included</Text>
              <Text style={styles.coverMetaValue}>{entities.length}</Text>
            </View>
          </View>

          <View style={[styles.warningBox, { marginTop: 24 }]}>
            <Text style={[styles.warningText, { fontFamily: 'Helvetica-Bold', marginBottom: 3 }]}>
              Source protection notice
            </Text>
            <Text style={styles.warningText}>
              This document does not contain identity information for anonymous or confidential sources. The organization that prepared this report maintains source protection obligations. Do not attempt to identify sources from the content of this package.
            </Text>
          </View>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>THREADLINE — CONFIDENTIAL</Text>
          <Text style={styles.footerText}>{dateStr}</Text>
        </View>
      </Page>

      {/* Methodology + Case summary */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Case Summary</Text>
        <Text style={styles.bodyText}>{caseSummary || 'No summary provided.'}</Text>

        <Text style={styles.sectionTitle}>Methodology</Text>
        <Text style={styles.bodyText}>{methodologyNote || 'No methodology note provided.'}</Text>

        <Text style={styles.sectionTitle}>Confidence Statement</Text>
        <Text style={styles.bodyText}>{confidenceStatement || 'No confidence statement provided.'}</Text>

        <View style={[styles.warningBox, { marginTop: 20 }]}>
          <Text style={styles.warningText}>
            Claims in this document are labeled with their epistemic status (CONFIRMED, REPORTED, or POSSIBLE CONNECTION). Only claims that have been reviewed and verified by human analysts are included. No AI-generated content is present in this package.
          </Text>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>THREADLINE — CONFIDENTIAL</Text>
          <Text style={styles.footerText}>Page 2</Text>
        </View>
      </Page>

      {/* Claims table */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Claims ({claims.length})</Text>

        <View style={styles.tableHeader}>
          <Text style={[styles.tableHeaderCell, { width: '10%' }]}>#</Text>
          <Text style={[styles.tableHeaderCell, { width: '45%' }]}>Claim</Text>
          <Text style={[styles.tableHeaderCell, { width: '15%' }]}>Type</Text>
          <Text style={[styles.tableHeaderCell, { width: '15%' }]}>Status</Text>
          <Text style={[styles.tableHeaderCell, { width: '15%' }]}>Confidence</Text>
        </View>

        {claims.map((claim, i) => (
          <View key={claim.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
            <Text style={[styles.tableCell, { width: '10%' }]}>{i + 1}</Text>
            <Text style={[styles.tableCell, { width: '45%', fontSize: 8 }]} numberOfLines={4}>
              {claim.extracted_text}
              {claim.interpretation_flag ? '\n[INTERPRETATION — not direct observation]' : ''}
            </Text>
            <Text style={[styles.tableCell, { width: '15%', fontSize: 8 }]}>
              {claim.claim_type.replace('_', ' ')}
            </Text>
            <Text style={[styles.tableCell, { width: '15%', fontSize: 8 }]}>
              {claim.verification_status.replace('_', ' ')}
            </Text>
            <Text style={[styles.tableCell, { width: '15%', fontSize: 8 }]}>
              Src: {claim.source_confidence}{'\n'}Clm: {claim.content_confidence}
            </Text>
          </View>
        ))}

        <View style={styles.footer}>
          <Text style={styles.footerText}>THREADLINE — CONFIDENTIAL</Text>
          <Text style={styles.footerText}>Page 3</Text>
        </View>
      </Page>

      {/* Entities table */}
      {entities.length > 0 && (
        <Page size="LETTER" style={styles.page}>
          <Text style={styles.sectionTitle}>Entities ({entities.length})</Text>

          <View style={styles.tableHeader}>
            <Text style={[styles.tableHeaderCell, { width: '20%' }]}>Type</Text>
            <Text style={[styles.tableHeaderCell, { width: '40%' }]}>Value</Text>
            <Text style={[styles.tableHeaderCell, { width: '40%' }]}>Normalized value</Text>
          </View>

          {entities.map((entity, i) => (
            <View key={entity.id} style={i % 2 === 0 ? styles.tableRow : styles.tableRowAlt}>
              <Text style={[styles.tableCell, { width: '20%' }]}>
                {entity.entity_type}
              </Text>
              <Text style={[styles.tableCell, { width: '40%' }]}>
                {entity.raw_value}
              </Text>
              <Text style={[styles.tableCell, { width: '40%' }]}>
                {entity.normalized_value ?? '—'}
              </Text>
            </View>
          ))}

          <View style={styles.footer}>
            <Text style={styles.footerText}>THREADLINE — CONFIDENTIAL</Text>
            <Text style={styles.footerText}>Page 4</Text>
          </View>
        </Page>
      )}

      {/* Chain of custody */}
      <Page size="LETTER" style={styles.page}>
        <Text style={styles.sectionTitle}>Chain of Custody</Text>
        <View style={styles.coverMeta}>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Case title</Text>
            <Text style={styles.coverMetaValue}>{caseTitle}</Text>
          </View>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Exported</Text>
            <Text style={styles.coverMetaValue}>{new Date(exportDate).toISOString()}</Text>
          </View>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Exported by</Text>
            <Text style={styles.coverMetaValue}>{preparedBy}</Text>
          </View>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Claims count</Text>
            <Text style={styles.coverMetaValue}>{claims.length}</Text>
          </View>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Entities count</Text>
            <Text style={styles.coverMetaValue}>{entities.length}</Text>
          </View>
          <View style={styles.coverMetaRow}>
            <Text style={styles.coverMetaLabel}>Generated by</Text>
            <Text style={styles.coverMetaValue}>Threadline Case Intelligence Platform</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Important Notices</Text>
        <Text style={[styles.bodyText, { marginBottom: 8 }]}>
          This document was prepared by human analysts using structured case intelligence software. No claims have been generated by artificial intelligence. All claims represent human-reviewed and categorized information from submitted accounts.
        </Text>
        <Text style={[styles.bodyText, { marginBottom: 8 }]}>
          The confidence labels in this document reflect analyst judgment, not certainty. &quot;Confirmed&quot; indicates corroboration by multiple independent sources or official verification. &quot;Reported&quot; indicates the information has been reviewed but not independently verified. &quot;Possible connection&quot; indicates an interpretation or inference, not a direct observation.
        </Text>
        <Text style={styles.bodyText}>
          Recipients of this document are responsible for conducting their own verification before taking action on any information contained herein.
        </Text>

        <View style={styles.footer}>
          <Text style={styles.footerText}>THREADLINE — CONFIDENTIAL</Text>
          <Text style={styles.footerText}>End of document</Text>
        </View>
      </Page>
    </Document>
  )
}
