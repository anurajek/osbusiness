import { useState } from 'react'
import { SectionHeader } from '../components/ui'
import ChartOfAccountsScreen from './ChartOfAccountsScreen'
import JournalEntriesScreen from './JournalEntriesScreen'
import ReportsScreen from './ReportsScreen'

export default function LedgerScreen() {
  const [tab, setTab] = useState('accounts')

  return (
    <>
      <SectionHeader title="Ledger" note="chart of accounts, journal entries, financial reports" />
      <div className="tabs">
        <button className={`tab ${tab === 'accounts' ? 'tab--active' : ''}`} onClick={() => setTab('accounts')}>Chart of Accounts</button>
        <button className={`tab ${tab === 'journal' ? 'tab--active' : ''}`} onClick={() => setTab('journal')}>Journal Entries</button>
        <button className={`tab ${tab === 'reports' ? 'tab--active' : ''}`} onClick={() => setTab('reports')}>Reports</button>
      </div>
      {tab === 'accounts' && <ChartOfAccountsScreen />}
      {tab === 'journal' && <JournalEntriesScreen />}
      {tab === 'reports' && <ReportsScreen />}
    </>
  )
}
