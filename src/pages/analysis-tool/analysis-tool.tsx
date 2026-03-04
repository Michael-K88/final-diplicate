import React from 'react';
import './analysis-tool.scss';

const AnalysisTool: React.FC = () => {
    return (
        <div className='analysis-tool'>
            <div className='analysis-tool__frame-wrap'>
                <iframe
                    src='https://api.binarytool.site/'
                    title='Binarytool Analysis Tool'
                    className='analysis-tool__iframe'
                />
            </div>
        </div>
    );
};

export default AnalysisTool;
