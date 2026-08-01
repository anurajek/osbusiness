import { useState } from 'react'
import { SectionHeader } from '../components/ui'
import CreditDebitNoteScreen from './CreditDebitNoteScreen'

export default function CreditDebitNotesScreen() {
  const [tab, setTab] = useState('credit')

  return (
    <>
      <SectionHeader title="Credit / Debit Notes" note="corrections and refunds, without editing invoice history" />
      <div className="tabs">
        <button className={`tab ${tab === 'credit' ? 'tab--active' : ''}`} onClick={() => setTab('credit')}>Credit Notes</button>
        <button className={`tab ${tab === 'debit' ? 'tab--active' : ''}`} onClick={() => setTab('debit')}>Debit Notes</button>
      </div>
      {tab === 'credit' ? <CreditDebitNoteScreen type="credit" /> : <CreditDebitNoteScreen type="debit" />}
    </>
  )
}
