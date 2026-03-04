import React from 'react';
import IframeWrapper from '@/components/iframe-wrapper/iframe-wrapper';

const AnalysisTool: React.FC = () => {
    return (
        <IframeWrapper src='https://api.binarytool.site/' title='Analysis Tool' className='analysis-tool-container' />
    );
};

export default AnalysisTool;
