import React from 'react';
import { Link } from 'react-router-dom';
import './Terms.css';

const TERMS_PDF_URL = process.env.REACT_APP_TERMS_PDF_URL || '';

const TERMS_CONTENT = [
  {
    title: 'MASHARTI YA HUDUMA',
    items: [
      {
        num: '1.',
        text: 'Toa taarifa kwa nguo zinazohitaji ufuaji maalum',
        sub: [
          'Nguo za bei ghali na gharama zisizo za kawaida',
          'Nguo zenye madoa',
          'Nguo zinazohitaji marekebisho (Vifungo au Kushonwa)',
          'Nguo laini au dhaifu'
        ]
      },
      {
        num: '2.',
        text: 'Tutatoa fidia kwa matatizo yanayotokana na makosa yetu. Mfano: Nguo kuharibika au kupotea, mara tano ya bei ya kufulia na si ghrama halisi ya bei ya nguo hiyo, na nguo hiyo haitarudishwa.'
      },
      {
        num: '3.',
        text: 'Hatutawajibika kwa upotevu, uharibifu au wizi unaotokana na matatizo ya kijamii na majanga ya asili ya kijamii.'
      },
      {
        num: '4.',
        text: 'Nguo zisizochukuliwa baada ya siku 45 zitaondolewa kwenye orodha au kuuzwa ili kufidia gharama za ufuaji.'
      },
      {
        num: '5.',
        text: 'Kagua vizuri nguo zako kabla ya kuondoka kaunta.'
      },
      {
        num: '6.',
        text: 'Kupokelewa kwa kazi hii kunathibitisha kukubalika kwa hayo hapo juu.'
      }
    ]
  }
];

const Terms = () => {
  return (
    <div className="terms-page">
      <div className="terms-container">
        <header className="terms-header">
          <h1>SUPACLEAN</h1>
          <p className="terms-subtitle">Laundry & Dry Cleaning · Arusha, Tanzania</p>
          <h2>MASHARTI YA HUDUMA</h2>
        </header>

        {TERMS_PDF_URL && (
          <section className="terms-pdf-section">
            <p className="terms-pdf-label">Terms & conditions (PDF):</p>
            <iframe
              title="Terms and Conditions PDF"
              src={TERMS_PDF_URL}
              className="terms-pdf-iframe"
            />
            <a href={TERMS_PDF_URL} target="_blank" rel="noopener noreferrer" className="terms-pdf-link">
              Open PDF in new tab
            </a>
          </section>
        )}

        <section className="terms-body">
          {TERMS_CONTENT.map((section, sIdx) => (
            <div key={sIdx}>
              {section.items.map((item, iIdx) => (
                <div key={iIdx} className="terms-item">
                  <span className="terms-num">{item.num}</span>
                  <div className="terms-item-content">
                    <p className="terms-item-text">{item.text}</p>
                    {item.sub && (
                      <ul className="terms-sublist">
                        {item.sub.map((line, j) => (
                          <li key={j}>{line}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </section>

        <footer className="terms-footer">
          <p>Asante kwa kuchagua SUPACLEAN.</p>
          <Link to="/login" className="terms-back">← Back to app</Link>
        </footer>
      </div>
    </div>
  );
};

export default Terms;
