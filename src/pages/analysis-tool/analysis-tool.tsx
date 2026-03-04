import React from 'react';
import './analysis-tool.scss';

const AnalysisTool: React.FC = () => {
    return (
        <div className='analysis-tool'>
            <div className='analysis-tool__header'>
                <span className='analysis-tool__header-icon'>📊</span>
                <span className='analysis-tool__header-title'>Blue Traders Analysis Tool</span>
            </div>
            <div className='analysis-tool__frame-wrap'>
                <iframe
                    src='https://api.binarytool.site/'
                    title='Blue Traders Analysis Tool'
                    className='analysis-tool__iframe'
                />
            </div>
        </div>
    );
};

export default AnalysisTool;
